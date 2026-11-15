// MicroSD backup-storage test for a classic (full-size) ESP32 DevKit.
//
// Wiring (VSPI default pins), same GPIOs for both tested adapters:
//   Adapter CS          -> GPIO4  (moved from GPIO5 during bench debugging)
//   Adapter SCK / CLK   -> GPIO18
//   Adapter MOSI        -> GPIO23
//   Adapter MISO        -> GPIO19
//   Adapter GND         -> GND
//   Power depends on the adapter:
//     A: 6-pin "MicroSD Card Adapter" (CS SCK MOSI MISO VCC GND, AMS1117
//        regulator): VCC -> 5V / VIN. Its regulator needs ~5 V in.
//     B: 6-pin 3.3 V adapter (3V3 CS MOSI CLK MISO GND): 3V3 -> ESP32 3V3.
//        Never 5 V on its 3V3 pin.
//
// What it does:
//   1. Mounts the card (4 MHz, falling back to 400 kHz) and prints card info.
//   2. Writes a 256 KiB pseudo-random file, reads it back, compares every
//      byte, reports throughput, then deletes it.
//   3. Appends one CSV record every 5 s to /sdtest/backup_log.csv, closing the
//      file after each record and checking the file grew by the exact amount.
//      After a reset or power cut it resumes the sequence and reports whether
//      the last record was torn (power lost mid-write).
//   4. If the card is removed or a write fails, it unmounts and retries the
//      mount every 5 s.
//
// It only creates/removes files inside /sdtest. It never formats the card.
// Serial Monitor: 115200 baud. Send h for the command list.

#include <Arduino.h>
#include <FS.h>
#include <SD.h>
#include <SPI.h>
#include "driver/gpio.h"

#if !CONFIG_IDF_TARGET_ESP32
#error "Select a classic ESP32 board (e.g. ESP32 Dev Module). For the ESP32-C3 use sd_card_reader_test."
#endif

constexpr int SD_CS_PIN = 4;
constexpr int SD_SCK_PIN = 18;
constexpr int SD_MISO_PIN = 19;
constexpr int SD_MOSI_PIN = 23;

constexpr uint32_t SD_FAST_HZ = 4000000;  // Same speed the old C3 logger used.
constexpr uint32_t SD_SLOW_HZ = 400000;   // Fallback for long/poor jumper wires.

constexpr const char *TEST_DIR = "/sdtest";
constexpr const char *LOG_PATH = "/sdtest/backup_log.csv";
constexpr const char *PATTERN_PATH = "/sdtest/pattern.bin";
constexpr const char *LOG_HEADER = "boot,seq,uptime_ms,prev_write_us\n";

constexpr size_t PATTERN_BYTES = 256 * 1024;
constexpr size_t CHUNK_BYTES = 4096;
constexpr uint32_t LOG_INTERVAL_MS = 5000;
constexpr uint32_t REMOUNT_INTERVAL_MS = 5000;

bool mounted = false;
bool diagnosedThisStreak = false;  // MISO line check already printed.
bool paused = false;  // Set by the 'u' command so the card can be pulled safely.
uint32_t mountedHz = 0;
uint32_t bootNumber = 0;
uint32_t sequence = 0;
uint32_t prevWriteUs = 0;
uint32_t recordsOk = 0;
uint32_t recordsFailed = 0;
uint32_t maxWriteUs = 0;
uint32_t lastLogMs = 0;
uint32_t lastMountAttemptMs = 0;

uint8_t writeBuf[CHUNK_BYTES];
uint8_t readBuf[CHUNK_BYTES];

const char *cardTypeName(uint8_t type) {
  switch (type) {
    case CARD_MMC: return "MMC";
    case CARD_SD: return "SDSC";
    case CARD_SDHC: return "SDHC/SDXC";
    default: return "unknown";
  }
}

void printCardInfo() {
  Serial.printf("Card type: %s\n", cardTypeName(SD.cardType()));
  Serial.printf("Card size: %llu MiB\n", SD.cardSize() / (1024ULL * 1024ULL));
  Serial.printf("FAT volume: %llu MiB total, %llu MiB used\n",
                SD.totalBytes() / (1024ULL * 1024ULL),
                SD.usedBytes() / (1024ULL * 1024ULL));
  Serial.printf("SPI clock: %lu kHz\n", (unsigned long)(mountedHz / 1000));
}

// Fills buf with a repeatable xorshift32 stream so the read-back can be
// regenerated and compared without holding the whole file in RAM.
void fillPattern(uint8_t *buf, size_t len, uint32_t &state) {
  for (size_t i = 0; i < len; i += 4) {
    state ^= state << 13;
    state ^= state >> 17;
    state ^= state << 5;
    memcpy(buf + i, &state, 4);
  }
}

bool runPatternTest() {
  const uint64_t freeBytes = SD.totalBytes() - SD.usedBytes();
  if (freeBytes < PATTERN_BYTES * 2) {
    Serial.println("Write/verify test: SKIPPED (not enough free space)");
    return false;
  }

  const uint32_t seed = esp_random() | 1;  // xorshift state must be non-zero.
  uint32_t state = seed;

  Serial.printf("Write/verify test: %u KiB...\n", (unsigned)(PATTERN_BYTES / 1024));
  File f = SD.open(PATTERN_PATH, FILE_WRITE);
  if (!f) {
    Serial.println("Write/verify test: FAIL (cannot create pattern file)");
    return false;
  }
  uint32_t t0 = millis();
  for (size_t off = 0; off < PATTERN_BYTES; off += CHUNK_BYTES) {
    fillPattern(writeBuf, CHUNK_BYTES, state);
    if (f.write(writeBuf, CHUNK_BYTES) != CHUNK_BYTES) {
      f.close();
      Serial.printf("Write/verify test: FAIL (short write at byte %u)\n", (unsigned)off);
      return false;
    }
  }
  f.close();
  const uint32_t writeMs = max<uint32_t>(1, millis() - t0);

  f = SD.open(PATTERN_PATH, FILE_READ);
  if (!f || f.size() != PATTERN_BYTES) {
    Serial.printf("Write/verify test: FAIL (reopened size %u, expected %u)\n",
                  f ? (unsigned)f.size() : 0, (unsigned)PATTERN_BYTES);
    f.close();
    return false;
  }
  state = seed;
  t0 = millis();
  for (size_t off = 0; off < PATTERN_BYTES; off += CHUNK_BYTES) {
    fillPattern(writeBuf, CHUNK_BYTES, state);
    if (f.read(readBuf, CHUNK_BYTES) != CHUNK_BYTES) {
      f.close();
      Serial.printf("Write/verify test: FAIL (short read at byte %u)\n", (unsigned)off);
      return false;
    }
    if (memcmp(writeBuf, readBuf, CHUNK_BYTES) != 0) {
      f.close();
      Serial.printf("Write/verify test: FAIL (data mismatch in chunk at byte %u)\n",
                    (unsigned)off);
      return false;
    }
  }
  f.close();
  const uint32_t readMs = max<uint32_t>(1, millis() - t0);
  SD.remove(PATTERN_PATH);

  Serial.printf("Write/verify test: PASS (write %lu KiB/s, read %lu KiB/s, every byte matched)\n",
                (unsigned long)(PATTERN_BYTES / 1024 * 1000 / writeMs),
                (unsigned long)(PATTERN_BYTES / 1024 * 1000 / readMs));
  return true;
}

// Reads the tail of the log to find the last complete record, so the sequence
// continues across resets and torn (partially written) records are reported.
void resumeLog() {
  bootNumber = 1;
  sequence = 0;

  if (!SD.exists(LOG_PATH)) {
    File f = SD.open(LOG_PATH, FILE_WRITE);
    if (f) {
      f.print(LOG_HEADER);
      f.close();
    }
    Serial.println("Backup log: created new /sdtest/backup_log.csv (boot 1)");
    return;
  }

  File f = SD.open(LOG_PATH, FILE_READ);
  if (!f) {
    Serial.println("Backup log: WARNING cannot open existing log for reading");
    return;
  }
  const size_t size = f.size();
  char tail[257];
  const size_t start = size > 256 ? size - 256 : 0;
  f.seek(start);
  size_t n = f.read(reinterpret_cast<uint8_t *>(tail), size - start);
  f.close();
  tail[n] = '\0';

  const bool torn = n > 0 && tail[n - 1] != '\n';
  if (torn) {
    Serial.println("Backup log: last record is INCOMPLETE (power lost mid-write); terminating it");
    File a = SD.open(LOG_PATH, FILE_APPEND);
    if (a) {
      a.print('\n');
      a.close();
    }
  }

  // Drop the torn fragment, then walk complete lines backwards until one
  // parses as "boot,seq,uptime_ms,prev_write_us".
  if (torn) {
    char *lastNewline = strrchr(tail, '\n');
    if (lastNewline) *lastNewline = '\0';
    else tail[0] = '\0';
  } else if (n > 0) {
    tail[n - 1] = '\0';  // Remove the final '\n'.
  }
  while (tail[0] != '\0') {
    char *newline = strrchr(tail, '\n');
    // With start > 0 the first segment may begin mid-line; never trust it.
    if (!newline && start > 0) break;
    const char *text = newline ? newline + 1 : tail;
    unsigned long b = 0, s = 0, up = 0, us = 0;
    if (sscanf(text, "%lu,%lu,%lu,%lu", &b, &s, &up, &us) == 4) {
      bootNumber = b + 1;
      sequence = s;
      break;
    }
    if (!newline) break;
    *newline = '\0';
  }

  Serial.printf("Backup log: %u bytes, resuming at boot %lu after seq %lu\n",
                (unsigned)size, (unsigned long)bootNumber, (unsigned long)sequence);
}

// Reads a pin with the ESP32's weak (~45 kOhm) pull-down, then pull-up.
// Returns true when the level stays the same, i.e. something stronger holds it.
bool pinHeld(int pin, int &level) {
  pinMode(pin, INPUT_PULLDOWN);
  delay(5);
  const int down = digitalRead(pin);
  pinMode(pin, INPUT_PULLUP);
  delay(5);
  const int up = digitalRead(pin);
  pinMode(pin, INPUT);
  level = down;
  return down == up;
}

// MISO: adapter A's 74LVC125A buffer drives it whenever the module is powered;
// adapter B may hold it with a pull-up. "Held" means MISO is wired. It does NOT
// prove the adapter has power: the ESP32 signal pins can back-feed the
// adapter's 3.3 V rail through its pull-ups when VCC/GND are not connected.
// Only a voltmeter on the adapter's VCC/3V3 and GND pins proves power.
// "Floating" means the MISO wire is open, the adapter has no power, or (on an
// unbuffered adapter with no pull-up) nothing holds MISO while the card is idle.
// CS/SCK/MOSI: the buffer inputs are high-impedance. "Held" means a pull
// resistor on the adapter is reached through that wire (wire connected).
// "Floating" is inconclusive, because the adapter may have no pull resistor there.
// Pulls ALL four signal pins low at once, so no ESP32 pin can back-feed the
// adapter. A line that still reads HIGH is held by a pull-up or buffer running
// from the adapter's own VCC/3V3 wire: the adapter is really powered.
// All LOW: the VCC/3V3 wire is not delivering power (or the adapter has no
// pull-ups at all). This cannot check the GND wire.
void powerCheck() {
  const int pins[] = {SD_MISO_PIN, SD_CS_PIN, SD_SCK_PIN, SD_MOSI_PIN};
  const char *names[] = {"MISO", "CS", "SCK", "MOSI"};
  for (int p : pins) pinMode(p, INPUT_PULLDOWN);
  delay(50);
  int highCount = 0;
  Serial.print("Power check (all pins pulled down together):");
  for (int i = 0; i < 4; ++i) {
    const int v = digitalRead(pins[i]);
    highCount += v;
    Serial.printf(" %s=%d", names[i], v);
  }
  Serial.println();
  if (highCount > 0) {
    Serial.println("  -> adapter rail is POWERED from its own VCC/3V3 wire");
  } else {
    Serial.println("  -> all LOW: adapter rail NOT powered (check VCC/3V3 wire and its row)");
  }
  for (int p : pins) pinMode(p, INPUT);
}

// A powered SD card that has not yet entered SPI mode has an internal 10-90 kOhm
// pull-up on its CS (CD/DAT3) pin. With the ESP32's weak (~45 kOhm) pull-down
// on CS, the ADC then reads a mid voltage. ~0 V means nothing pulls CS up:
// the CS wire does not reach a seated, powered card. The pull-up reading only
// confirms that the ESP32 pull resistors are active in analog mode.
void csCardCheck() {
  const gpio_num_t cs = static_cast<gpio_num_t>(SD_CS_PIN);
  analogReadMilliVolts(SD_CS_PIN);  // First call configures the pin for the ADC.
  auto average = [&]() {
    delay(20);
    uint32_t sum = 0;
    for (int i = 0; i < 16; ++i) sum += analogReadMilliVolts(SD_CS_PIN);
    return sum / 16;
  };
  gpio_pullup_dis(cs);
  gpio_pulldown_en(cs);
  const uint32_t downMv = average();
  gpio_pulldown_dis(cs);
  gpio_pullup_en(cs);
  const uint32_t upMv = average();
  gpio_pullup_dis(cs);
  pinMode(SD_CS_PIN, INPUT);

  Serial.printf("CS card check (GPIO%d ADC): pull-down %lu mV, pull-up %lu mV\n", SD_CS_PIN,
                (unsigned long)downMv, (unsigned long)upMv);
  if (upMv < 2500) {
    Serial.println("  -> INCONCLUSIVE (pull-up reading low; pulls not effective in ADC mode)");
  } else if (downMv < 150) {
    Serial.println("  -> ~0 V: no card pull-up on CS. CS wire does not reach a seated,");
    Serial.println("     powered card (wrong pin/row, adapter CS trace, or card contact)");
  } else if (downMv < 3000) {
    Serial.println("  -> card's CS pull-up seen: CS reaches a seated, powered card");
  } else {
    Serial.println("  -> CS held near 3.3 V by something stronger than a card pull-up");
  }
}

void diagnoseLines() {
  SD.end();
  SPI.end();
  powerCheck();
  csCardCheck();
  struct Line { const char *name; int pin; } lines[] = {
      {"MISO", SD_MISO_PIN}, {"CS", SD_CS_PIN}, {"SCK", SD_SCK_PIN}, {"MOSI", SD_MOSI_PIN}};
  for (const Line &l : lines) {
    int level = 0;
    const bool held = pinHeld(l.pin, level);
    Serial.printf("Line check %-4s (GPIO%d): ", l.name, l.pin);
    if (l.pin == SD_MISO_PIN) {
      Serial.println(held ? "held -> MISO wired (power NOT proven; measure VCC-GND)"
                          : "FLOATING -> MISO wire open, adapter unpowered, or no pull-up on MISO");
    } else if (held) {
      Serial.printf("held %s -> wire reaches a pull resistor on the adapter\n",
                    level ? "HIGH" : "LOW");
    } else {
      Serial.println("follows pulls -> inconclusive (no pull resistor seen on this line)");
    }
  }
  pinMode(SD_CS_PIN, OUTPUT);
  digitalWrite(SD_CS_PIN, HIGH);
  SPI.begin(SD_SCK_PIN, SD_MISO_PIN, SD_MOSI_PIN, SD_CS_PIN);
}

// Bit-banged SPI mode 0 at roughly 50 kHz, used only by the wiring scan.
uint8_t bbTransfer(int sck, int mosi, int miso, uint8_t out) {
  uint8_t in = 0;
  for (int bit = 7; bit >= 0; --bit) {
    digitalWrite(mosi, (out >> bit) & 1);
    delayMicroseconds(10);
    digitalWrite(sck, HIGH);
    in = (in << 1) | (digitalRead(miso) & 1);
    delayMicroseconds(10);
    digitalWrite(sck, LOW);
  }
  return in;
}

// Sends CMD0 (GO_IDLE_STATE) and returns the R1 response (0x01 = card answered).
uint8_t bbCmd0(int sck, int mosi, int miso) {
  const uint8_t cmd0[] = {0x40, 0x00, 0x00, 0x00, 0x00, 0x95};
  pinMode(SD_CS_PIN, OUTPUT);
  digitalWrite(SD_CS_PIN, HIGH);
  pinMode(sck, OUTPUT);
  digitalWrite(sck, LOW);
  pinMode(mosi, OUTPUT);
  digitalWrite(mosi, HIGH);
  pinMode(miso, INPUT_PULLUP);
  for (int i = 0; i < 10; ++i) bbTransfer(sck, mosi, miso, 0xFF);  // >= 74 clocks
  digitalWrite(SD_CS_PIN, LOW);
  for (uint8_t b : cmd0) bbTransfer(sck, mosi, miso, b);
  uint8_t r = 0xFF;
  for (int i = 0; i < 16; ++i) {
    r = bbTransfer(sck, mosi, miso, 0xFF);
    if ((r & 0x80) == 0) break;
  }
  digitalWrite(SD_CS_PIN, HIGH);
  bbTransfer(sck, mosi, miso, 0xFF);
  pinMode(sck, INPUT);
  pinMode(mosi, INPUT);
  pinMode(miso, INPUT);
  return r;
}

// Tries CMD0 with every assignment of SCK/MOSI/MISO to GPIO18/19/23 (CS fixed),
// to detect swapped signal wires. The card drives its output only after a valid
// command, which needs the correct SCK and MOSI wires, so wrong guesses never
// put the ESP32 and the card in output conflict.
void scanWiring() {
  SD.end();
  SPI.end();
  const int pins[] = {SD_SCK_PIN, SD_MOSI_PIN, SD_MISO_PIN};
  const int perms[6][3] = {{0, 1, 2}, {0, 2, 1}, {1, 0, 2}, {1, 2, 0}, {2, 0, 1}, {2, 1, 0}};
  Serial.printf("Wiring scan (CS=GPIO%d, raw CMD0 at ~50 kHz):\n", SD_CS_PIN);
  bool found = false;
  for (const auto &p : perms) {
    const int sck = pins[p[0]], mosi = pins[p[1]], miso = pins[p[2]];
    uint8_t r = bbCmd0(sck, mosi, miso);
    if (r != 0x01) r = bbCmd0(sck, mosi, miso);  // Some cards need a second CMD0.
    const bool ok = r == 0x01;
    found |= ok;
    Serial.printf("  SCK=GPIO%-2d MOSI=GPIO%-2d MISO=GPIO%-2d -> 0x%02X %s%s\n", sck, mosi, miso,
                  r, ok ? "CARD ANSWERED" : "no answer",
                  (ok && p[0] == 0 && p[1] == 1) ? " (expected wiring)" : "");
  }
  if (!found) {
    Serial.println("  No assignment answered: check CS wire, card power (3.3 V at card), GND, seating.");
  }
  pinMode(SD_CS_PIN, OUTPUT);
  digitalWrite(SD_CS_PIN, HIGH);
  SPI.begin(SD_SCK_PIN, SD_MISO_PIN, SD_MOSI_PIN, SD_CS_PIN);
}

bool mountCard() {
  SD.end();
  const uint32_t speeds[] = {SD_FAST_HZ, SD_SLOW_HZ};
  for (uint32_t hz : speeds) {
    if (SD.begin(SD_CS_PIN, SPI, hz, "/sd", 5, false) && SD.cardType() != CARD_NONE) {
      mounted = true;
      mountedHz = hz;
      diagnosedThisStreak = false;
      Serial.printf("Mount: PASS at %lu kHz\n", (unsigned long)(hz / 1000));
      if (hz != SD_FAST_HZ) {
        Serial.println("  (fast clock failed; shorten wires / check connections)");
      }
      printCardInfo();
      if (!SD.exists(TEST_DIR) && !SD.mkdir(TEST_DIR)) {
        Serial.println("Mount: WARNING cannot create /sdtest");
      }
      return true;
    }
    SD.end();
  }
  mounted = false;
  Serial.println("Mount: FAIL (no card, not FAT16/FAT32, or wiring/power problem)");
  // Run the line check on the first failure of each streak, not every retry.
  if (!diagnosedThisStreak) {
    diagnoseLines();
    scanWiring();
  }
  diagnosedThisStreak = true;
  return false;
}

void onMounted() {
  runPatternTest();
  resumeLog();
  lastLogMs = millis();
}

void appendRecord() {
  char line[64];
  const int len = snprintf(line, sizeof line, "%lu,%lu,%lu,%lu\n",
                           (unsigned long)bootNumber, (unsigned long)(sequence + 1),
                           (unsigned long)millis(), (unsigned long)prevWriteUs);

  const uint32_t t0 = micros();
  bool ok = false;
  size_t before = 0;
  File f = SD.open(LOG_PATH, FILE_APPEND);
  if (f) {
    before = f.size();
    ok = f.write(reinterpret_cast<const uint8_t *>(line), len) == static_cast<size_t>(len);
    f.close();  // close() flushes the FAT/directory entry to the card.
  }
  const uint32_t writeUs = micros() - t0;

  if (ok) {
    File check = SD.open(LOG_PATH, FILE_READ);
    ok = check && check.size() == before + len;
    check.close();
  }

  if (!ok) {
    ++recordsFailed;
    Serial.printf("LOG seq=%lu FAIL - unmounting, will retry mount every %lu s\n",
                  (unsigned long)(sequence + 1), (unsigned long)(REMOUNT_INTERVAL_MS / 1000));
    SD.end();
    mounted = false;
    lastMountAttemptMs = millis();
    return;
  }

  ++sequence;
  ++recordsOk;
  prevWriteUs = writeUs;
  if (writeUs > maxWriteUs) maxWriteUs = writeUs;
  Serial.printf("LOG boot=%lu seq=%lu write=%.1f ms OK\n", (unsigned long)bootNumber,
                (unsigned long)sequence, writeUs / 1000.0f);
}

void printLogTail() {
  File f = SD.open(LOG_PATH, FILE_READ);
  if (!f) {
    Serial.println("No backup log on card.");
    return;
  }
  const size_t size = f.size();
  if (size > 2048) {
    f.seek(size - 2048);
    f.readStringUntil('\n');  // Skip the partial first line.
    Serial.println("--- last ~2 KiB of /sdtest/backup_log.csv ---");
  } else {
    Serial.println("--- /sdtest/backup_log.csv ---");
  }
  while (f.available()) Serial.write(f.read());
  f.close();
  Serial.println("--- end ---");
}

void printStatus() {
  Serial.printf("Status: %s%s, boot=%lu seq=%lu ok=%lu failed=%lu max_write=%.1f ms\n",
                mounted ? "mounted" : "NOT mounted", paused ? " (paused)" : "",
                (unsigned long)bootNumber, (unsigned long)sequence,
                (unsigned long)recordsOk, (unsigned long)recordsFailed, maxWriteUs / 1000.0f);
  if (mounted) printCardInfo();
}

void printHelp() {
  Serial.println("Commands: s=status  t=write/verify test  p=print log tail");
  Serial.println("          c=clear test log  u=unmount (safe to remove card)  m=mount");
  Serial.println("          w=wiring scan (when not mounted)  h=help");
}

void handleCommand(char cmd) {
  switch (cmd) {
    case 's': printStatus(); break;
    case 'w':
      if (mounted) Serial.println("Card mounted; send u first to run the wiring scan.");
      else scanWiring();
      break;
    case 'h': case '?': printHelp(); break;
    case 'u':
      SD.end();
      mounted = false;
      paused = true;
      Serial.println("Unmounted. Safe to remove the card. Send m to mount again.");
      break;
    case 'm':
      paused = false;
      if (mountCard()) onMounted();
      lastMountAttemptMs = millis();
      break;
    case 't':
    case 'p':
    case 'c':
      if (!mounted) {
        Serial.println("Card not mounted.");
        break;
      }
      if (cmd == 't') runPatternTest();
      if (cmd == 'p') printLogTail();
      if (cmd == 'c') {
        SD.remove(LOG_PATH);
        Serial.println("Deleted /sdtest/backup_log.csv; starting a new log.");
        resumeLog();
      }
      break;
    default: break;  // Ignore newlines and unknown characters.
  }
}

void setup() {
  Serial.begin(115200);
  delay(1200);
  Serial.println();
  Serial.println("ESP32 MicroSD backup-storage test");
  Serial.println("CS=GPIO4 SCK/CLK=GPIO18 MOSI=GPIO23 MISO=GPIO19");
  Serial.println("Power: AMS1117 adapter VCC->5V/VIN; 3V3-pin adapter 3V3->3V3");
  printHelp();

  pinMode(SD_CS_PIN, OUTPUT);
  digitalWrite(SD_CS_PIN, HIGH);
  SPI.begin(SD_SCK_PIN, SD_MISO_PIN, SD_MOSI_PIN, SD_CS_PIN);

  if (mountCard()) onMounted();
  lastMountAttemptMs = millis();
}

void loop() {
  while (Serial.available()) handleCommand(static_cast<char>(Serial.read()));

  const uint32_t now = millis();
  if (mounted) {
    if (now - lastLogMs >= LOG_INTERVAL_MS) {
      lastLogMs = now;
      appendRecord();
    }
  } else if (!paused && now - lastMountAttemptMs >= REMOUNT_INTERVAL_MS) {
    lastMountAttemptMs = now;
    if (mountCard()) onMounted();
  }
}
