// MicroSD backup-storage test for the ESP32-C3 SuperMini coop board.
// PROPOSAL / BENCH TEST ONLY: this replaces the coop firmware while it runs.
// It never touches NVS (calibration, Wi-Fi settings) or the flash-queue
// partition; it is built with the coop monitor's own partitions.csv.
//
// Wiring (see ../sd_backup_esp32_test/wiring_c3_proposal.html):
//   MQ-135 AO -> 10k -> GPIO3, GPIO3 -> 10k -> GND   (unchanged)
//   AHT20/BMP280 SDA GPIO4, SCL GPIO5, VIN 3V3       (unchanged)
//   SD CS GPIO10, SCK GPIO6, MOSI GPIO7, MISO GPIO1
//   SD adapter VCC 5V (AMS1117 adapter) or 3V3 (3V3-pin adapter, never 5V)
//
// Card-friendly write strategy:
//   * Readings are buffered in RAM, not written one by one.
//   * Every FLUSH_INTERVAL_MS (15 min) only whole 512-byte sectors are
//     appended; the remainder (< 512 bytes) stays in RAM for the next flush.
//     The file size therefore always stays sector-aligned, so no sector on
//     the card is ever written twice for log data, and the FAT/directory
//     entry is updated once per flush instead of once per reading.
//   * Each boot starts a new file, so a power cut never forces a rewrite
//     of the previous file's last sector.
//   * Each flush is read back and byte-compared (reads do not wear flash).
//   Cost: a power cut loses the readings still in RAM (at most one flush
//   interval plus < 512 bytes). Everything flushed before stays on the card.

#include <Arduino.h>
#include <FS.h>
#include <SD.h>
#include <SPI.h>
#include <Wire.h>
#include <math.h>
#include "aht20_reader.h"
#include "bmp280_reader.h"

#if !CONFIG_IDF_TARGET_ESP32C3
#error "Build for ESP32-C3 (esp32:esp32:nologo_esp32c3_super_mini)"
#endif

// Coop monitor pins and ADC settings (same as coop_monitor.ino).
constexpr int MQ_ANALOG_PIN = 3;
constexpr int I2C_SDA_PIN = 4;
constexpr int I2C_SCL_PIN = 5;
constexpr uint8_t AHT20_ADDRESS = 0x38;
constexpr uint8_t BMP280_ADDRESS_1 = 0x76;
constexpr uint8_t BMP280_ADDRESS_2 = 0x77;
constexpr uint32_t I2C_CLOCK_HZ = 100000;

// MicroSD (new pins).
constexpr int SD_CS_PIN = 10;
constexpr int SD_SCK_PIN = 6;
constexpr int SD_MOSI_PIN = 7;
constexpr int SD_MISO_PIN = 1;
constexpr uint32_t SD_FAST_HZ = 4000000;
constexpr uint32_t SD_SLOW_HZ = 400000;

constexpr uint32_t SAMPLE_INTERVAL_MS = 5000;           // coop revision 4: 5 s
constexpr uint32_t FLUSH_INTERVAL_MS = 15UL * 60UL * 1000UL;
constexpr size_t SECTOR = 512;
constexpr size_t BUF_BYTES = 16384;                     // ~22 min of readings
constexpr size_t FLUSH_EARLY_BYTES = 12288;             // flush early if this full
constexpr uint32_t REMOUNT_INTERVAL_MS = 30000;
constexpr char LOG_DIR[] = "/coop";
constexpr char LOG_HEADER[] =
    "seq,uptime_s,mq_raw,mq_adc_mv,aht_c,rh_pct,bmp_c,pressure_hpa,flush_ms_before\n";

Aht20Reader aht20;
Bmp280Reader bmp280;
bool ahtReady = false, bmpReady = false;
uint8_t bmpAddress = 0;

static char buf[BUF_BYTES];
static uint8_t verifyBuf[SECTOR];
size_t used = 0;

bool mounted = false;
uint32_t mountedHz = 0;
char logPath[32] = "";
uint32_t fileNumber = 0;
uint32_t fileBytes = 0;   // bytes on card in the current file (sector-aligned)
bool fileSealed = false;  // true after 'u' wrote a partial sector

uint32_t seq = 0;
uint32_t lastSampleMs = 0, lastFlushMs = 0, lastMountAttemptMs = 0;
uint32_t pendingFlushMs = 0;  // flush duration reported in the next record
uint32_t flushes = 0, flushBytes = 0, flushFails = 0, verifyFails = 0, dropped = 0;
uint32_t maxFlushMs = 0;

bool i2cDevicePresent(uint8_t address) {
  Wire.beginTransmission(address);
  return Wire.endTransmission() == 0;
}

bool beginBmp280() {
  if (i2cDevicePresent(BMP280_ADDRESS_1) && bmp280.begin(Wire, BMP280_ADDRESS_1)) { bmpAddress = BMP280_ADDRESS_1; return true; }
  if (i2cDevicePresent(BMP280_ADDRESS_2) && bmp280.begin(Wire, BMP280_ADDRESS_2)) { bmpAddress = BMP280_ADDRESS_2; return true; }
  return false;
}

// ---------- card ----------

uint32_t nextFileNumber() {
  uint32_t highest = 0;
  File dir = SD.open(LOG_DIR);
  if (!dir) return 1;
  for (File f = dir.openNextFile(); f; f = dir.openNextFile()) {
    const char *name = f.name();
    const char *base = strrchr(name, '/');
    base = base ? base + 1 : name;
    unsigned long n = 0;
    if (sscanf(base, "b%05lu.csv", &n) == 1 && n > highest) highest = n;
    f.close();
  }
  dir.close();
  return highest + 1;
}

void listFiles() {
  File dir = SD.open(LOG_DIR);
  if (!dir) { Serial.println("  (no /coop directory)"); return; }
  for (File f = dir.openNextFile(); f; f = dir.openNextFile()) {
    Serial.printf("  %s  %lu bytes\n", f.name(), static_cast<unsigned long>(f.size()));
    f.close();
  }
  dir.close();
}

void startNewFile() {
  fileNumber = nextFileNumber();
  snprintf(logPath, sizeof(logPath), "%s/b%05lu.csv", LOG_DIR, static_cast<unsigned long>(fileNumber));
  fileBytes = 0;
  fileSealed = false;
  Serial.printf("Log file: %s (created at first flush)\n", logPath);
}

bool mountCard() {
  SPI.begin(SD_SCK_PIN, SD_MISO_PIN, SD_MOSI_PIN, SD_CS_PIN);
  const uint32_t speeds[] = {SD_FAST_HZ, SD_SLOW_HZ};
  for (uint32_t hz : speeds) {
    if (SD.begin(SD_CS_PIN, SPI, hz, "/sd", 5, false) && SD.cardType() != CARD_NONE) {
      mounted = true;
      mountedHz = hz;
      if (!SD.exists(LOG_DIR)) SD.mkdir(LOG_DIR);
      Serial.printf("Mount: PASS at %lu kHz, card %llu MiB, FAT %llu MiB used of %llu MiB\n",
                    static_cast<unsigned long>(hz / 1000), SD.cardSize() >> 20,
                    SD.usedBytes() >> 20, SD.totalBytes() >> 20);
      Serial.println("Existing log files:");
      listFiles();
      // A remount mid-run keeps going in a fresh file: the old one may end
      // mid-sector if the card was pulled.
      startNewFile();
      return true;
    }
    SD.end();
  }
  mounted = false;
  Serial.println("Mount: FAIL (check card, FAT32, wiring CS10/SCK6/MOSI7/MISO1, power)");
  return false;
}

void unmountAfterError(const char *what) {
  ++flushFails;
  Serial.printf("SD ERROR: %s -> unmounting, retry every %lu s; readings stay in RAM\n",
                what, static_cast<unsigned long>(REMOUNT_INTERVAL_MS / 1000));
  SD.end();
  mounted = false;
  lastMountAttemptMs = millis();
}

// Append the first n bytes of buf, read them back and compare.
bool writeAndVerify(size_t n) {
  const uint32_t t0 = millis();
  File f = SD.open(logPath, FILE_APPEND);
  if (!f) { unmountAfterError("open for append failed"); return false; }
  if (f.size() != fileBytes) {
    Serial.printf("SD ERROR: file size %lu, expected %lu\n", static_cast<unsigned long>(f.size()),
                  static_cast<unsigned long>(fileBytes));
    f.close(); unmountAfterError("unexpected file size"); return false;
  }
  const size_t wrote = f.write(reinterpret_cast<const uint8_t *>(buf), n);
  f.close();
  if (wrote != n) { unmountAfterError("short write"); return false; }

  File r = SD.open(logPath, FILE_READ);
  if (!r || r.size() != fileBytes + n || !r.seek(fileBytes)) {
    if (r) r.close();
    unmountAfterError("read-back open/size failed"); return false;
  }
  bool same = true;
  for (size_t off = 0; off < n && same; off += SECTOR) {
    const size_t len = min(SECTOR, n - off);
    same = r.read(verifyBuf, len) == static_cast<int>(len) && memcmp(verifyBuf, buf + off, len) == 0;
  }
  r.close();
  if (!same) { ++verifyFails; unmountAfterError("read-back MISMATCH"); return false; }

  const uint32_t ms = millis() - t0;
  fileBytes += n;
  ++flushes; flushBytes += n;
  if (ms > maxFlushMs) maxFlushMs = ms;
  pendingFlushMs = ms;
  memmove(buf, buf + n, used - n);
  used -= n;
  Serial.printf("FLUSH #%lu: %u bytes (%u sectors) -> %s, verified, %lu ms; file now %lu bytes; %u bytes kept in RAM\n",
                static_cast<unsigned long>(flushes), static_cast<unsigned>(n), static_cast<unsigned>(n / SECTOR),
                logPath, static_cast<unsigned long>(ms), static_cast<unsigned long>(fileBytes),
                static_cast<unsigned>(used));
  return true;
}

// Normal flush: whole sectors only.
void flushAligned(const char *why) {
  lastFlushMs = millis();
  if (!mounted || fileSealed) return;
  const size_t n = used - (used % SECTOR);
  if (!n) { Serial.printf("FLUSH (%s): less than one sector buffered, nothing written\n", why); return; }
  Serial.printf("FLUSH (%s)...\n", why);
  writeAndVerify(n);
}

// Before safe removal: write everything, including a partial last sector.
void flushAllAndUnmount() {
  if (mounted && !fileSealed && used) {
    Serial.println("FLUSH (unmount): writing all buffered data including the partial sector");
    if (writeAndVerify(used)) fileSealed = true;
  }
  if (mounted) { SD.end(); mounted = false; }
  Serial.println("Unmounted: safe to remove the card. 'm' remounts (new file).");
}

// Mount and make sure the buffered data starts with the CSV header, because
// every mount starts a new file.
void mountForNewFile() {
  if (!mountCard()) return;
  constexpr size_t H = sizeof(LOG_HEADER) - 1;
  if (strncmp(buf, LOG_HEADER, H) != 0 && used + H <= BUF_BYTES) {
    memmove(buf + H, buf, used);
    memcpy(buf, LOG_HEADER, H);
    used += H;
  }
}

// ---------- sensors ----------

void sampleOnce() {
  constexpr uint8_t MQ_READS = 32;  // same averaging as coop_monitor.ino
  uint32_t rawTotal = 0, mvTotal = 0;
  for (uint8_t i = 0; i < MQ_READS; ++i) {
    rawTotal += analogRead(MQ_ANALOG_PIN);
    mvTotal += analogReadMilliVolts(MQ_ANALOG_PIN);
    delay(2);
  }
  const uint32_t mqRaw = rawTotal / MQ_READS, mqMv = mvTotal / MQ_READS;

  float t = NAN, rh = NAN, bt = NAN, hpa = NAN;
  if (!ahtReady) ahtReady = aht20.begin(Wire, AHT20_ADDRESS);
  if (ahtReady && !aht20.read(t, rh)) { ahtReady = false; t = rh = NAN; }
  if (!bmpReady) bmpReady = beginBmp280();
  if (bmpReady && !bmp280.read(bt, hpa)) { bmpReady = false; bt = hpa = NAN; }

  ++seq;
  char line[128];
  const int len = snprintf(line, sizeof(line), "%lu,%lu,%lu,%lu,%.2f,%.2f,%.2f,%.2f,%lu\n",
                           static_cast<unsigned long>(seq), static_cast<unsigned long>(millis() / 1000),
                           static_cast<unsigned long>(mqRaw), static_cast<unsigned long>(mqMv),
                           t, rh, bt, hpa, static_cast<unsigned long>(pendingFlushMs));
  pendingFlushMs = 0;
  if (len <= 0 || used + len > BUF_BYTES) { ++dropped; Serial.println("RAM buffer full: reading DROPPED"); return; }
  memcpy(buf + used, line, len);
  used += len;
  Serial.printf("READ %s", line);
}

// ---------- serial ----------

void printStatus() {
  Serial.printf("Status: %s, file %s, on card %lu bytes, RAM %u/%u bytes, seq=%lu\n",
                mounted ? "mounted" : "NOT mounted",
                logPath[0] ? logPath : "-", static_cast<unsigned long>(fileBytes),
                static_cast<unsigned>(used), static_cast<unsigned>(BUF_BYTES), static_cast<unsigned long>(seq));
  Serial.printf("  flushes=%lu bytes=%lu flush_fail=%lu verify_fail=%lu dropped=%lu max_flush=%lu ms, next flush in %lu s\n",
                static_cast<unsigned long>(flushes), static_cast<unsigned long>(flushBytes),
                static_cast<unsigned long>(flushFails), static_cast<unsigned long>(verifyFails),
                static_cast<unsigned long>(dropped), static_cast<unsigned long>(maxFlushMs),
                static_cast<unsigned long>((FLUSH_INTERVAL_MS - min(FLUSH_INTERVAL_MS, millis() - lastFlushMs)) / 1000));
  Serial.printf("  sensors: AHT20 %s, BMP280 %s", ahtReady ? "ok" : "ERROR", bmpReady ? "ok" : "ERROR");
  if (bmpReady) Serial.printf(" (0x%02X)", bmpAddress);
  Serial.println();
}

void printTail() {
  if (!mounted || !fileBytes) { Serial.println("Nothing on card yet for this file (wait for a flush or press f)."); return; }
  File r = SD.open(logPath, FILE_READ);
  if (!r) { Serial.println("Cannot open log for reading."); return; }
  const uint32_t start = r.size() > 1536 ? r.size() - 1536 : 0;
  r.seek(start);
  Serial.printf("--- last %lu bytes of %s (as stored on the card) ---\n",
                static_cast<unsigned long>(r.size() - start), logPath);
  while (r.available()) Serial.write(r.read());
  r.close();
  Serial.println("\n--- end ---");
}

void help() {
  Serial.println("Commands: s=status  f=flush whole sectors now  p=print tail of card file");
  Serial.println("          l=list files  u=flush all + unmount (safe removal)  m=mount  h=help");
}

void setup() {
  Serial.begin(115200);
  Serial.setTxTimeoutMs(0);  // never block sampling when no computer is attached
  delay(1500);
  Serial.println();
  Serial.println("ESP32-C3 MicroSD backup test (coop pins; NOT the coop firmware)");
  Serial.println("MQ GPIO3 | I2C SDA4/SCL5 | SD CS10 SCK6 MOSI7 MISO1");
  Serial.printf("Sample every %lu s; flush whole 512-byte sectors every %lu min\n",
                static_cast<unsigned long>(SAMPLE_INTERVAL_MS / 1000),
                static_cast<unsigned long>(FLUSH_INTERVAL_MS / 60000));
  Serial.println("MQ output is relative gas response, not ammonia ppm.");
  help();

  analogReadResolution(12);
  analogSetPinAttenuation(MQ_ANALOG_PIN, ADC_11db);
  Wire.begin(I2C_SDA_PIN, I2C_SCL_PIN);
  Wire.setClock(I2C_CLOCK_HZ);
  Wire.setTimeOut(50);
  ahtReady = aht20.begin(Wire, AHT20_ADDRESS);
  bmpReady = beginBmp280();
  Serial.printf("AHT20: %s, BMP280: %s\n", ahtReady ? "connected" : "not detected",
                bmpReady ? "connected" : "not detected");

  pinMode(SD_CS_PIN, OUTPUT);
  digitalWrite(SD_CS_PIN, HIGH);
  mountCard();
  lastMountAttemptMs = lastFlushMs = millis();

  memcpy(buf, LOG_HEADER, sizeof(LOG_HEADER) - 1);
  used = sizeof(LOG_HEADER) - 1;
  lastSampleMs = millis() - SAMPLE_INTERVAL_MS;
}

void loop() {
  const uint32_t now = millis();
  if (now - lastSampleMs >= SAMPLE_INTERVAL_MS) {
    lastSampleMs = now;
    sampleOnce();
    if (used >= FLUSH_EARLY_BYTES) flushAligned("buffer 3/4 full");
    else if (now - lastFlushMs >= FLUSH_INTERVAL_MS) flushAligned("15 min timer");
  }
  if (!mounted && now - lastMountAttemptMs >= REMOUNT_INTERVAL_MS) {
    lastMountAttemptMs = now;
    mountForNewFile();
  }
  while (Serial.available()) {
    switch (Serial.read()) {
      case 's': printStatus(); break;
      case 'f': flushAligned("manual"); break;
      case 'p': printTail(); break;
      case 'l': if (mounted) listFiles(); else Serial.println("Not mounted."); break;
      case 'u': flushAllAndUnmount(); break;
      case 'm': if (!mounted) mountForNewFile(); else Serial.println("Already mounted."); break;
      case 'h': help(); break;
      default: break;
    }
  }
  delay(5);
}
