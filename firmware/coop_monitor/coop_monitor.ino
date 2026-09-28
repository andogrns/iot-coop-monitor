#include <Arduino.h>
#include <Wire.h>
#include <SPI.h>
#include <SD.h>
#include <Preferences.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>
#include <Adafruit_AHTX0.h>
#include <Adafruit_BMP280.h>
#include <math.h>
#include <errno.h>
#include <stdlib.h>
#include <string.h>

// ESP32-C3 SuperMini: MQ-135, AHT20/BMP280, SSD1306 OLED, and SPI MicroSD.
// MQ-135 AO must pass through the 10 kOhm / 10 kOhm divider before GPIO3.
constexpr int MQ_ANALOG_PIN = 3;
constexpr int I2C_SDA_PIN = 4;
constexpr int I2C_SCL_PIN = 5;
constexpr int SD_CS_PIN = 10;
constexpr int SD_SCK_PIN = 6;
constexpr int SD_MOSI_PIN = 7;
constexpr int SD_MISO_PIN = 1;
constexpr uint8_t AHT20_ADDRESS = 0x38;
constexpr uint8_t BMP280_ADDRESS_1 = 0x76;
constexpr uint8_t BMP280_ADDRESS_2 = 0x77;
constexpr uint8_t OLED_ADDRESS_1 = 0x3C;
constexpr uint8_t OLED_ADDRESS_2 = 0x3D;
constexpr uint8_t OLED_WIDTH = 128;
constexpr uint8_t OLED_HEIGHT = 64;
constexpr int8_t OLED_RESET_PIN = -1;
constexpr float MQ_DIVIDER_SCALE = 2.0f;
constexpr uint16_t ADC_WARNING_MV = 2400;
constexpr char SENSOR_ID[] = "mq135-01";  // Keep this with the same physical MQ module.

constexpr uint32_t SAMPLE_INTERVAL_MS = 2000;
constexpr uint32_t LOG_INTERVAL_MS = 30000;
constexpr uint32_t SD_RETRY_MS = 10000;
constexpr uint32_t SD_SPI_HZ = 4000000;
constexpr size_t SD_TRANSFER_CHUNK_BYTES = 128;
constexpr uint8_t SD_LIST_MAX_DEPTH = 8;
constexpr char LOG_HEADER[] =
    "Record reason,Sample number,Uptime (s),MQ raw ADC,MQ ADC (mV),"
    "MQ output (V),MQ baseline ratio,AHT temperature (C),Humidity (%RH),"
    "BMP temperature (C),Pressure (hPa),Status";
constexpr uint32_t BOOT_WARMUP_MS = 10UL * 60UL * 1000UL;
constexpr uint32_t CAL_STABILIZE_MS = 10UL * 60UL * 1000UL;
constexpr uint32_t CAL_COLLECT_MS = 5UL * 60UL * 1000UL;
constexpr uint32_t MIN_CAL_SAMPLES = 60;
constexpr uint8_t WARNING_CONFIRMATION_SAMPLES = 3;
constexpr float ALERT_RISE_FRACTION = 0.15f;
constexpr float ALERT_SIGMA_MULTIPLIER = 3.0f;
constexpr uint16_t CAL_VERSION = 1;
constexpr char PREF_NAMESPACE[] = "coopcal";
constexpr uint32_t CAL_STORAGE_MAGIC = 0x43414C31UL;

Adafruit_AHTX0 aht20;
Adafruit_BMP280 bmp280(&Wire);
Adafruit_SSD1306 display(OLED_WIDTH, OLED_HEIGHT, &Wire, OLED_RESET_PIN);
Preferences preferences;
bool ahtReady = false;
bool bmpReady = false;
bool oledReady = false;
uint8_t bmpAddress = 0;
uint8_t oledAddress = 0;
uint32_t startedMs = 0;
uint32_t lastSampleMs = 0;
uint32_t sampleNumber = 0;
uint8_t warningStreak = 0;
bool sdReady = false;
bool hasLogged = false;
uint32_t lastLogMs = 0;
uint32_t lastSdAttemptMs = 0;
char logPath[20] = "";
char lastLoggedStatus[160] = "";
File transferFile;
bool transferActive = false;
uint32_t transferSize = 0;
uint32_t transferBytes = 0;
uint32_t transferSequence = 0;
uint32_t transferCrc = 0xFFFFFFFFUL;

struct Calibration {
  bool valid = false;
  float baselineMv = NAN;
  float thresholdMv = NAN;
  float sdMv = NAN;
  uint32_t samples = 0;
  float temperatureC = NAN;
  float humidityPercent = NAN;
};

Calibration calibration;

struct StoredCalibration {
  uint32_t magic;
  uint16_t version;
  uint16_t reserved;
  float baselineMv;
  float thresholdMv;
  float sdMv;
  uint32_t samples;
  float temperatureC;
  float humidityPercent;
};

enum class CalState { IDLE, STABILIZING, COLLECTING };
CalState calState = CalState::IDLE;
uint32_t calStateStartedMs = 0;

struct RunningStats {
  uint32_t count = 0;
  double mean = 0.0;
  double m2 = 0.0;

  void clear() { count = 0; mean = 0.0; m2 = 0.0; }
  void add(double value) {
    ++count;
    const double delta = value - mean;
    mean += delta / count;
    m2 += delta * (value - mean);
  }
  double sd() const { return count > 1 ? sqrt(m2 / (count - 1)) : 0.0; }
};

RunningStats mqMvStats;
RunningStats tempStats;
RunningStats humidityStats;

struct Reading {
  uint16_t mqRaw;
  uint16_t mqAdcMv;
  float mqModuleV;
  float ahtTemperatureC;
  float humidityPercent;
  float bmpTemperatureC;
  float pressureHpa;
  bool ahtValid;
  bool bmpValid;
};

char commandBuffer[192];
size_t commandLength = 0;
bool commandOverflow = false;

void addFlag(char *status, size_t capacity, const char *flag) {
  const size_t length = strlen(status);
  if (length < capacity) {
    snprintf(status + length, capacity - length, "%s%s", length ? "|" : "", flag);
  }
}

void printFloatOrNA(float value, uint8_t decimals) {
  if (isfinite(value)) Serial.print(value, decimals);
  else Serial.print("NA");
}

bool validCalibration(const Calibration &value) {
  return isfinite(value.baselineMv) && isfinite(value.thresholdMv) &&
         isfinite(value.sdMv) && value.baselineMv >= 10.0f &&
         value.baselineMv < ADC_WARNING_MV &&
         value.thresholdMv > value.baselineMv &&
         value.thresholdMv < ADC_WARNING_MV && value.sdMv >= 0.0f &&
         value.samples >= MIN_CAL_SAMPLES &&
         (!isfinite(value.humidityPercent) ||
          (value.humidityPercent >= 0.0f && value.humidityPercent <= 100.0f));
}

void loadCalibration() {
  if (!preferences.begin(PREF_NAMESPACE, true)) return;
  const uint8_t active = preferences.getUChar("active", 0);
  for (uint8_t attempt = 0; attempt < 2; ++attempt) {
    const uint8_t slot = attempt == 0 ? active : 1 - active;
    const char *key = slot == 0 ? "cal_a" : "cal_b";
    if (preferences.getBytesLength(key) != sizeof(StoredCalibration)) continue;
    StoredCalibration stored;
    if (preferences.getBytes(key, &stored, sizeof(stored)) != sizeof(stored) ||
        stored.magic != CAL_STORAGE_MAGIC || stored.version != CAL_VERSION) continue;
    Calibration loaded;
    loaded.baselineMv = stored.baselineMv;
    loaded.thresholdMv = stored.thresholdMv;
    loaded.sdMv = stored.sdMv;
    loaded.samples = stored.samples;
    loaded.temperatureC = stored.temperatureC;
    loaded.humidityPercent = stored.humidityPercent;
    loaded.valid = validCalibration(loaded);
    if (loaded.valid) {
      calibration = loaded;
      preferences.end();
      return;
    }
  }

  // Accept calibration written by the earlier sensor_calibration_test sketch.
  Calibration loaded;
  const bool markedValid = preferences.getBool("valid", false);
  const uint16_t version = preferences.getUShort("version", 0);
  loaded.baselineMv = preferences.getFloat("base_mv", NAN);
  loaded.thresholdMv = preferences.getFloat("thr_mv", NAN);
  loaded.sdMv = preferences.getFloat("sd_mv", 0.0f);
  loaded.samples = preferences.getUInt("samples", 0);
  loaded.temperatureC = preferences.getFloat("cal_temp", NAN);
  loaded.humidityPercent = preferences.getFloat("cal_rh", NAN);
  preferences.end();
  loaded.valid = markedValid && version == CAL_VERSION && validCalibration(loaded);
  if (loaded.valid) calibration = loaded;
}

bool saveCalibration(const Calibration &value) {
  if (!validCalibration(value) || !preferences.begin(PREF_NAMESPACE, false)) return false;
  const uint8_t active = preferences.getUChar("active", 0);
  const uint8_t target = active == 0 ? 1 : 0;
  const char *key = target == 0 ? "cal_a" : "cal_b";
  const StoredCalibration stored = {
      CAL_STORAGE_MAGIC, CAL_VERSION, 0, value.baselineMv, value.thresholdMv,
      value.sdMv, value.samples, value.temperatureC, value.humidityPercent};
  // Write the inactive copy first. A failed write leaves the old copy selected.
  const bool written = preferences.putBytes(key, &stored, sizeof(stored)) == sizeof(stored);
  const bool selected = written && preferences.putUChar("active", target) > 0;
  preferences.end();
  if (selected) calibration = value;
  return selected;
}

void exportCalibration() {
  if (!calibration.valid) {
    Serial.printf("@CAL,MISSING,%s\n", SENSOR_ID);
    return;
  }
  // This line also allows a manual calibration backup through Serial Monitor.
  Serial.printf("@CAL,DATA,%u,%s,%d,", CAL_VERSION, SENSOR_ID, MQ_ANALOG_PIN);
  Serial.print(MQ_DIVIDER_SCALE, 3);
  Serial.print(",RISING,");
  Serial.print(calibration.baselineMv, 3);
  Serial.print(',');
  Serial.print(calibration.thresholdMv, 3);
  Serial.print(',');
  Serial.print(calibration.sdMv, 3);
  Serial.print(',');
  Serial.print(calibration.samples);
  Serial.print(',');
  printFloatOrNA(calibration.temperatureC, 2);
  Serial.print(',');
  printFloatOrNA(calibration.humidityPercent, 2);
  Serial.println();
}

bool i2cDevicePresent(uint8_t address) {
  Wire.beginTransmission(address);
  return Wire.endTransmission() == 0;
}

bool beginBmp280() {
  if (i2cDevicePresent(BMP280_ADDRESS_1) && bmp280.begin(BMP280_ADDRESS_1)) {
    bmpAddress = BMP280_ADDRESS_1;
    return true;
  }
  if (i2cDevicePresent(BMP280_ADDRESS_2) && bmp280.begin(BMP280_ADDRESS_2)) {
    bmpAddress = BMP280_ADDRESS_2;
    return true;
  }
  return false;
}

bool beginOled() {
  if (i2cDevicePresent(OLED_ADDRESS_1)) oledAddress = OLED_ADDRESS_1;
  else if (i2cDevicePresent(OLED_ADDRESS_2)) oledAddress = OLED_ADDRESS_2;
  else return false;
  return display.begin(SSD1306_SWITCHCAPVCC, oledAddress, true, false);
}

bool beginSdLog() {
  lastSdAttemptMs = millis();
  SD.end();
  if (!SD.begin(SD_CS_PIN, SPI, SD_SPI_HZ) || SD.cardType() == CARD_NONE) {
    sdReady = false;
    SD.end();
    Serial.println("MicroSD unavailable; retrying every 10 seconds.");
    return false;
  }

  // A new file for each boot keeps uptime-only records from different boots apart.
  if (!logPath[0]) {
    for (unsigned int number = 1; number <= 9999; ++number) {
      char candidate[sizeof(logPath)];
      snprintf(candidate, sizeof(candidate), "/COOP%04u.CSV", number);
      if (!SD.exists(candidate)) {
        strcpy(logPath, candidate);
        break;
      }
    }
  }
  if (!logPath[0]) {
    sdReady = false;
    SD.end();
    Serial.println("MicroSD has no free COOP0001.CSV through COOP9999.CSV filename.");
    return false;
  }

  File file = SD.open(logPath, FILE_APPEND);
  if (!file) {
    sdReady = false;
    SD.end();
    Serial.println("MicroSD log file could not be opened; retrying.");
    return false;
  }
  if (file.size() == 0) {
    const size_t written = file.println(LOG_HEADER);
    file.close();
    if (written < strlen(LOG_HEADER) + 1) {
      sdReady = false;
      SD.remove(logPath);
      SD.end();
      logPath[0] = '\0';
      Serial.println("MicroSD CSV header write failed; retrying.");
      return false;
    }
  } else {
    file.close();
  }
  sdReady = true;
  Serial.printf("MicroSD logging to %s (30 seconds and status changes).\n", logPath);
  return true;
}

void failSdLog() {
  sdReady = false;
  lastSdAttemptMs = millis();
  SD.end();
  Serial.println("MicroSD write failed; logging paused until card is available.");
}

Reading readSensors() {
  constexpr uint8_t MQ_READS = 32;
  uint32_t rawTotal = 0;
  uint32_t mvTotal = 0;
  for (uint8_t i = 0; i < MQ_READS; ++i) {
    rawTotal += analogRead(MQ_ANALOG_PIN);
    mvTotal += analogReadMilliVolts(MQ_ANALOG_PIN);
    delay(2);
  }

  Reading value;
  value.mqRaw = rawTotal / MQ_READS;
  value.mqAdcMv = mvTotal / MQ_READS;
  value.mqModuleV = value.mqAdcMv * MQ_DIVIDER_SCALE / 1000.0f;
  value.ahtTemperatureC = NAN;
  value.humidityPercent = NAN;
  value.bmpTemperatureC = NAN;
  value.pressureHpa = NAN;
  value.ahtValid = false;
  value.bmpValid = false;
  if (ahtReady) {
    sensors_event_t humidityEvent;
    sensors_event_t temperatureEvent;
    if (aht20.getEvent(&humidityEvent, &temperatureEvent)) {
      value.ahtTemperatureC = temperatureEvent.temperature;
      value.humidityPercent = humidityEvent.relative_humidity;
      value.ahtValid = isfinite(value.ahtTemperatureC) &&
                       isfinite(value.humidityPercent) &&
                       value.humidityPercent >= 0.0f &&
                       value.humidityPercent <= 100.0f;
    }
  }
  if (bmpReady) {
    value.bmpTemperatureC = bmp280.readTemperature();
    value.pressureHpa = bmp280.readPressure() / 100.0f;
    value.bmpValid = isfinite(value.bmpTemperatureC) &&
                     isfinite(value.pressureHpa) && value.pressureHpa > 0.0f;
  }
  return value;
}

void displayNumberOrDashes(float value, uint8_t decimals) {
  if (isfinite(value)) display.print(value, decimals);
  else display.print("--");
}

void showOnOled(const Reading &reading, const char *status) {
  if (!oledReady) return;
  display.clearDisplay();
  display.setTextSize(1);
  display.setTextColor(SSD1306_WHITE);
  display.setCursor(0, 0);
  display.print("COOP AIR MONITOR");
  display.drawLine(0, 9, OLED_WIDTH - 1, 9, SSD1306_WHITE);

  display.setCursor(0, 12);
  display.print("MQ ");
  display.print(reading.mqAdcMv);
  display.print("mV x");
  if (calibration.valid) display.print(reading.mqAdcMv / calibration.baselineMv, 2);
  else display.print("--");

  display.setCursor(0, 21);
  display.print("THR ");
  if (calibration.valid) display.print(calibration.thresholdMv, 0);
  else display.print("--");
  display.print("mV");

  display.setCursor(0, 30);
  display.print("AHT ");
  displayNumberOrDashes(reading.ahtValid ? reading.ahtTemperatureC : NAN, 1);
  display.print("C ");
  displayNumberOrDashes(reading.ahtValid ? reading.humidityPercent : NAN, 1);
  display.print("%");

  display.setCursor(0, 39);
  display.print("BMP ");
  displayNumberOrDashes(reading.bmpValid ? reading.bmpTemperatureC : NAN, 1);
  display.print("C");

  display.setCursor(0, 48);
  display.print("P ");
  displayNumberOrDashes(reading.bmpValid ? reading.pressureHpa : NAN, 1);
  display.print("hPa");

  display.setCursor(0, 56);
  if (strstr(status, "GAS_WARNING")) display.print("GAS WARNING");
  else if (strstr(status, "MQ_ADC_HIGH")) display.print("MQ ADC HIGH");
  else if (!sdReady) display.print("SD ERROR");
  else if (strstr(status, "CAL_STABILIZING")) display.print("CAL STABILIZING");
  else if (strstr(status, "CAL_COLLECTING")) display.print("CAL COLLECTING");
  else if (strstr(status, "AHT_ERROR")) display.print("AHT ERROR");
  else if (strstr(status, "BMP_ERROR")) display.print("BMP ERROR");
  else if (strstr(status, "WARMUP")) display.print("WARMUP");
  else if (strstr(status, "CAL_MISSING")) display.print("CAL MISSING");
  else display.print("OK");
  display.display();
}

void startCalibration() {
  if (!ahtReady) ahtReady = aht20.begin(&Wire, 0, AHT20_ADDRESS);
  if (!ahtReady) {
    Serial.println("@CAL,FAILED,AHT_NOT_DETECTED");
    return;
  }
  mqMvStats.clear();
  tempStats.clear();
  humidityStats.clear();
  warningStreak = 0;
  calState = CalState::STABILIZING;
  calStateStartedMs = millis();
  Serial.println("@CAL,STATE,STABILIZING");
  Serial.println("Keep the conditioned MQ-135 in stable clean reference air.");
}

void finishCalibration() {
  calState = CalState::IDLE;
  if (mqMvStats.count < MIN_CAL_SAMPLES || tempStats.count < MIN_CAL_SAMPLES ||
      humidityStats.count < MIN_CAL_SAMPLES) {
    Serial.println("@CAL,FAILED,TOO_FEW_VALID_SAMPLES");
    return;
  }

  Calibration next;
  next.baselineMv = mqMvStats.mean;
  next.sdMv = mqMvStats.sd();
  next.thresholdMv = max(next.baselineMv * (1.0f + ALERT_RISE_FRACTION),
                         next.baselineMv + ALERT_SIGMA_MULTIPLIER * next.sdMv);
  next.samples = mqMvStats.count;
  next.temperatureC = tempStats.mean;
  next.humidityPercent = humidityStats.mean;
  next.valid = validCalibration(next);
  if (!next.valid) {
    Serial.println("@CAL,FAILED,UNSTABLE_OR_OUT_OF_RANGE");
    return;
  }
  if (!saveCalibration(next)) {
    Serial.println("@CAL,FAILED,STORAGE_ERROR");
    return;
  }
  Serial.println("@CAL,SAVED");
  exportCalibration();
}

void updateCalibration(const Reading &reading, uint32_t now) {
  if (calState == CalState::STABILIZING) {
    if (now - calStateStartedMs >= CAL_STABILIZE_MS) {
      calState = CalState::COLLECTING;
      calStateStartedMs = now;
      Serial.println("@CAL,STATE,COLLECTING");
    }
  } else if (calState == CalState::COLLECTING) {
    if (reading.mqAdcMv < ADC_WARNING_MV && reading.ahtValid) {
      mqMvStats.add(reading.mqAdcMv);
      tempStats.add(reading.ahtTemperatureC);
      humidityStats.add(reading.humidityPercent);
    }
    if (now - calStateStartedMs >= CAL_COLLECT_MS) finishCalibration();
  }
}

void formatReadableStatus(const char *status, char *output, size_t capacity) {
  const char *flags[] = {"CAL_STABILIZING", "CAL_COLLECTING", "WARMUP",
                        "CAL_MISSING", "AHT_ERROR", "BMP_ERROR", "OLED_ERROR",
                        "MQ_ADC_HIGH", "GAS_WARNING"};
  const char *labels[] = {"Calibration stabilizing", "Calibration collecting",
                         "Warming up", "Calibration missing", "AHT sensor error",
                         "BMP sensor error", "OLED error", "MQ ADC high",
                         "Gas warning"};
  output[0] = '\0';
  for (size_t i = 0; i < sizeof(flags) / sizeof(flags[0]); ++i) {
    if (!strstr(status, flags[i])) continue;
    const size_t length = strlen(output);
    if (length < capacity) {
      snprintf(output + length, capacity - length, "%s%s", length ? " | " : "",
               labels[i]);
    }
  }
  if (!output[0]) snprintf(output, capacity, "OK");
}

void printReadableStatus(const char *status) {
  char readable[192];
  formatReadableStatus(status, readable, sizeof(readable));
  Serial.println(readable);
}

// Keep labeled Serial output for live diagnostics and calibration commands.
void printReadingBlock(const Reading &reading, const char *status, uint32_t uptime) {
  Serial.printf("--- Sample %lu | Uptime %02lu:%02lu:%02lu ---\n",
                (unsigned long)sampleNumber, (unsigned long)(uptime / 3600UL),
                (unsigned long)((uptime / 60UL) % 60UL),
                (unsigned long)(uptime % 60UL));
  Serial.printf("MQ-135  : ADC %u mV | Output %.3f V | Raw %u\n",
                reading.mqAdcMv, reading.mqModuleV, reading.mqRaw);
  Serial.print("Baseline: ");
  if (calibration.valid) {
    const float ratio = reading.mqAdcMv / calibration.baselineMv;
    Serial.printf("%.4fx (%+.1f%%) | Warning threshold %.0f mV\n",
                  ratio, (ratio - 1.0f) * 100.0f, calibration.thresholdMv);
  } else {
    Serial.println("NA | Warning threshold NA mV");
  }
  Serial.print("AHT20   : Temperature ");
  printFloatOrNA(reading.ahtValid ? reading.ahtTemperatureC : NAN, 2);
  Serial.print(" C | Humidity ");
  printFloatOrNA(reading.ahtValid ? reading.humidityPercent : NAN, 2);
  Serial.println(" %RH");
  Serial.print("BMP280  : Temperature ");
  printFloatOrNA(reading.bmpValid ? reading.bmpTemperatureC : NAN, 2);
  Serial.print(" C | Pressure ");
  printFloatOrNA(reading.bmpValid ? reading.pressureHpa : NAN, 2);
  Serial.println(" hPa");
  Serial.print("Status  : ");
  printReadableStatus(status);
  Serial.println();
}

void formatFloatOrNA(char *output, size_t capacity, float value, uint8_t decimals) {
  if (isfinite(value)) snprintf(output, capacity, "%.*f", decimals, (double)value);
  else snprintf(output, capacity, "NA");
}

bool formatLogRow(char *output, size_t capacity, const Reading &reading,
                  const char *status, uint32_t uptime, bool statusChanged) {
  char moduleV[20], ratio[20], ahtTemp[20], humidity[20], bmpTemp[20], pressure[20];
  char readableStatus[192];
  formatFloatOrNA(moduleV, sizeof(moduleV), reading.mqModuleV, 3);
  formatFloatOrNA(ratio, sizeof(ratio),
                  calibration.valid ? reading.mqAdcMv / calibration.baselineMv : NAN, 4);
  formatFloatOrNA(ahtTemp, sizeof(ahtTemp),
                  reading.ahtValid ? reading.ahtTemperatureC : NAN, 2);
  formatFloatOrNA(humidity, sizeof(humidity),
                  reading.ahtValid ? reading.humidityPercent : NAN, 2);
  formatFloatOrNA(bmpTemp, sizeof(bmpTemp),
                  reading.bmpValid ? reading.bmpTemperatureC : NAN, 2);
  formatFloatOrNA(pressure, sizeof(pressure),
                  reading.bmpValid ? reading.pressureHpa : NAN, 2);
  formatReadableStatus(status, readableStatus, sizeof(readableStatus));
  const int length = snprintf(
      output, capacity, "%s,%lu,%lu,%u,%u,%s,%s,%s,%s,%s,%s,%s",
      statusChanged ? "Status change" : "Periodic", (unsigned long)sampleNumber,
      (unsigned long)uptime, reading.mqRaw, reading.mqAdcMv, moduleV, ratio,
      ahtTemp, humidity, bmpTemp, pressure, readableStatus);
  return length > 0 && static_cast<size_t>(length) < capacity;
}

void logReading(const Reading &reading, const char *status, uint32_t now,
                uint32_t uptime) {
  // Keep SD writes out of an active read transfer. Sampling and Serial continue.
  if (!sdReady || transferActive) return;
  const bool statusChanged = hasLogged && strcmp(status, lastLoggedStatus) != 0;
  if (hasLogged && !statusChanged && now - lastLogMs < LOG_INTERVAL_MS) return;

  char row[384];
  if (!formatLogRow(row, sizeof(row), reading, status, uptime, statusChanged)) {
    Serial.println("MicroSD CSV row exceeded the buffer; reading not saved.");
    return;
  }
  File file = SD.open(logPath, FILE_APPEND);
  if (!file) {
    failSdLog();
    return;
  }
  const size_t written = file.println(row);
  file.close();  // Commit each row so a later power loss loses as little as possible.
  if (written < strlen(row) + 1) {
    failSdLog();
    return;
  }
  hasLogged = true;
  lastLogMs = now;
  strncpy(lastLoggedStatus, status, sizeof(lastLoggedStatus) - 1);
  lastLoggedStatus[sizeof(lastLoggedStatus) - 1] = '\0';
}

void takeReading() {
  const uint32_t now = millis();
  const Reading reading = readSensors();
  ++sampleNumber;
  updateCalibration(reading, now);

  char status[160] = "";
  if (calState == CalState::STABILIZING) addFlag(status, sizeof(status), "CAL_STABILIZING");
  if (calState == CalState::COLLECTING) addFlag(status, sizeof(status), "CAL_COLLECTING");
  if (now - startedMs < BOOT_WARMUP_MS) addFlag(status, sizeof(status), "WARMUP");
  if (!calibration.valid) addFlag(status, sizeof(status), "CAL_MISSING");
  if (!reading.ahtValid) addFlag(status, sizeof(status), "AHT_ERROR");
  if (!reading.bmpValid) addFlag(status, sizeof(status), "BMP_ERROR");
  if (!oledReady) addFlag(status, sizeof(status), "OLED_ERROR");
  const bool adcHigh = reading.mqAdcMv >= ADC_WARNING_MV;
  if (adcHigh) addFlag(status, sizeof(status), "MQ_ADC_HIGH");

  if (calState != CalState::IDLE || now - startedMs < BOOT_WARMUP_MS ||
      !calibration.valid || adcHigh) {
    warningStreak = 0;
  } else {
    if (reading.mqAdcMv >= calibration.thresholdMv) {
      if (warningStreak < 255) ++warningStreak;
    } else {
      warningStreak = 0;
    }
    if (warningStreak >= WARNING_CONFIRMATION_SAMPLES) {
      addFlag(status, sizeof(status), "GAS_WARNING");
    }
  }
  if (!status[0]) strcpy(status, "OK");

  const uint32_t uptime = (now - startedMs) / 1000UL;
  printReadingBlock(reading, status, uptime);
  logReading(reading, status, now, uptime);
  showOnOled(reading, status);
}

bool parseUnsigned(const char *text, uint32_t &value) {
  if (!text[0] || text[0] == '-') return false;
  errno = 0;
  char *end = nullptr;
  const unsigned long parsed = strtoul(text, &end, 10);
  if (errno != 0 || *end != '\0') return false;
  value = parsed;
  return true;
}

bool parseNumber(const char *text, float &value, bool optional = false) {
  if (optional && strcmp(text, "NA") == 0) {
    value = NAN;
    return true;
  }
  if (!text[0]) return false;
  errno = 0;
  char *end = nullptr;
  value = strtof(text, &end);
  return errno == 0 && *end == '\0' && isfinite(value);
}

void importCalibration(char *fieldsText) {
  if (calState != CalState::IDLE) {
    Serial.println("@CAL,ERROR,CALIBRATION_IN_PROGRESS");
    return;
  }
  char *parts[11];
  size_t count = 1;
  parts[0] = fieldsText;
  for (char *cursor = fieldsText; *cursor; ++cursor) {
    if (*cursor == ',') {
      *cursor = '\0';
      if (count >= 11) { Serial.println("@CAL,ERROR,IMPORT_FORMAT"); return; }
      parts[count++] = cursor + 1;
    }
  }
  if (count != 11) { Serial.println("@CAL,ERROR,IMPORT_FORMAT"); return; }

  uint32_t version, pin, samples;
  float divider;
  Calibration incoming;
  const bool parsed = parseUnsigned(parts[0], version) &&
                      strcmp(parts[1], SENSOR_ID) == 0 &&
                      parseUnsigned(parts[2], pin) &&
                      parseNumber(parts[3], divider) &&
                      strcmp(parts[4], "RISING") == 0 &&
                      parseNumber(parts[5], incoming.baselineMv) &&
                      parseNumber(parts[6], incoming.thresholdMv) &&
                      parseNumber(parts[7], incoming.sdMv) &&
                      parseUnsigned(parts[8], samples) &&
                      parseNumber(parts[9], incoming.temperatureC, true) &&
                      parseNumber(parts[10], incoming.humidityPercent, true);
  if (!parsed || version != CAL_VERSION || pin != MQ_ANALOG_PIN ||
      fabsf(divider - MQ_DIVIDER_SCALE) > 0.001f) {
    Serial.println("@CAL,ERROR,IMPORT_MISMATCH");
    return;
  }
  incoming.samples = samples;
  incoming.valid = validCalibration(incoming);
  if (!incoming.valid || !saveCalibration(incoming)) {
    Serial.println("@CAL,ERROR,IMPORT_INVALID_OR_STORAGE_ERROR");
    return;
  }
  warningStreak = 0;
  Serial.println("@CAL,IMPORTED");
}

void printSdHex(const uint8_t *bytes, size_t length) {
  static constexpr char HEX_DIGITS[] = "0123456789ABCDEF";
  for (size_t index = 0; index < length; ++index) {
    Serial.write(HEX_DIGITS[bytes[index] >> 4]);
    Serial.write(HEX_DIGITS[bytes[index] & 0x0F]);
  }
}

bool listSdDirectory(File &directory, uint8_t depth, uint32_t &count,
                     bool protocol) {
  File entry = directory.openNextFile();
  while (entry) {
    if (entry.isDirectory()) {
      if (depth >= SD_LIST_MAX_DEPTH ||
          !listSdDirectory(entry, depth + 1, count, protocol)) {
        entry.close();
        return false;
      }
    } else {
      const char *path = entry.path();
      if (!path) { entry.close(); return false; }
      if (protocol) {
        Serial.print("@SD,FILE,");
        printSdHex(reinterpret_cast<const uint8_t *>(path), strlen(path));
        Serial.printf(",%lu\n", (unsigned long)entry.size());
      } else {
        Serial.printf("  %s (%lu bytes)\n", path, (unsigned long)entry.size());
      }
      ++count;
    }
    entry.close();
    entry = directory.openNextFile();
  }
  return true;
}

void listSdFiles(bool protocol) {
  if (!sdReady) { Serial.println("@SD,ERROR,SD_NOT_READY"); return; }
  if (transferActive) { Serial.println("@SD,ERROR,BUSY"); return; }
  File root = SD.open("/");
  if (!root || !root.isDirectory()) {
    Serial.println("@SD,ERROR,LIST_OPEN_FAILED");
    return;
  }
  if (protocol) Serial.println("@SD,LIST,BEGIN,1");
  else Serial.println("MicroSD files:");
  uint32_t count = 0;
  const bool complete = listSdDirectory(root, 0, count, protocol);
  root.close();
  if (complete && protocol) Serial.printf("@SD,LIST,END,%lu\n", (unsigned long)count);
  else if (complete) Serial.printf("%lu file(s).\n", (unsigned long)count);
  else Serial.println("@SD,ERROR,LIST_INCOMPLETE");
}

bool validSdReadPath(const char *path) {
  if (!path || path[0] != '/' || !path[1] || strlen(path) >= 170 || strstr(path, ".."))
    return false;
  for (const char *cursor = path; *cursor; ++cursor) {
    if (static_cast<uint8_t>(*cursor) < 32) return false;
  }
  return true;
}

void startSdTransfer(const char *path) {
  if (!sdReady) { Serial.println("@SD,ERROR,SD_NOT_READY"); return; }
  if (transferActive) { Serial.println("@SD,ERROR,BUSY"); return; }
  if (!validSdReadPath(path)) { Serial.println("@SD,ERROR,INVALID_PATH"); return; }
  File file = SD.open(path, FILE_READ);
  if (!file || file.isDirectory()) {
    if (file) file.close();
    Serial.println("@SD,ERROR,FILE_NOT_FOUND");
    return;
  }
  transferFile = file;
  transferSize = static_cast<uint32_t>(transferFile.size());
  transferBytes = 0;
  transferSequence = 0;
  transferCrc = 0xFFFFFFFFUL;
  transferActive = true;
  Serial.print("@SD,GET,BEGIN,");
  printSdHex(reinterpret_cast<const uint8_t *>(path), strlen(path));
  Serial.printf(",%lu\n", (unsigned long)transferSize);
}

void serviceSdTransfer() {
  if (!transferActive) return;
  if (transferBytes == transferSize) {
    transferFile.close();
    transferActive = false;
    Serial.printf("@SD,GET,END,%lu,%08lX\n", (unsigned long)transferBytes,
                  (unsigned long)(transferCrc ^ 0xFFFFFFFFUL));
    return;
  }
  uint8_t bytes[SD_TRANSFER_CHUNK_BYTES];
  const size_t remaining = transferSize - transferBytes;
  const size_t wanted = remaining < sizeof(bytes) ? remaining : sizeof(bytes);
  const size_t received = transferFile.read(bytes, wanted);
  if (received != wanted) {
    transferFile.close();
    transferActive = false;
    Serial.println("@SD,ERROR,READ_FAILED");
    return;
  }
  Serial.printf("@SD,GET,DATA,%lu,", (unsigned long)transferSequence++);
  printSdHex(bytes, received);
  Serial.println();
  for (size_t index = 0; index < received; ++index) {
    transferCrc ^= bytes[index];
    for (uint8_t bit = 0; bit < 8; ++bit)
      transferCrc = (transferCrc >> 1) ^ ((transferCrc & 1) ? 0xEDB88320UL : 0);
  }
  transferBytes += received;
}

void handleCommand(char *command) {
  if (strcmp(command, "CAL START") == 0) startCalibration();
  else if (strcmp(command, "CAL CANCEL") == 0) {
    calState = CalState::IDLE;
    warningStreak = 0;
    Serial.println("@CAL,CANCELLED");
  } else if (strcmp(command, "CAL SHOW") == 0 ||
             strcmp(command, "CAL EXPORT") == 0) exportCalibration();
  else if (strncmp(command, "CAL IMPORT,", 11) == 0) importCalibration(command + 11);
  else if (strcmp(command, "SD LIST") == 0) listSdFiles(false);
  else if (strcmp(command, "SD LISTPROTO") == 0) listSdFiles(true);
  else if (strncmp(command, "SD GET ", 7) == 0) startSdTransfer(command + 7);
  else if (strcmp(command, "SD CANCEL") == 0) {
    if (transferActive) {
      transferFile.close();
      transferActive = false;
      Serial.println("@SD,GET,CANCELLED");
    }
  }
  else if (strcmp(command, "HELP") == 0) {
    Serial.println("Commands: CAL START, CAL CANCEL, CAL SHOW, CAL EXPORT, SD LIST, SD GET /FILE.CSV, SD CANCEL, HELP");
  } else if (command[0]) Serial.println("@CAL,ERROR,UNKNOWN_COMMAND");
}

void readSerialCommands() {
  while (Serial.available()) {
    const char ch = Serial.read();
    if (ch == '\r') continue;
    if (ch == '\n') {
      if (commandOverflow) Serial.println("@CAL,ERROR,COMMAND_TOO_LONG");
      else {
        commandBuffer[commandLength] = '\0';
        handleCommand(commandBuffer);
      }
      commandLength = 0;
      commandOverflow = false;
    } else if (!commandOverflow && commandLength < sizeof(commandBuffer) - 1) {
      commandBuffer[commandLength++] = ch;
    } else commandOverflow = true;
  }
}

void setup() {
  Serial.begin(115200);
  delay(1200);
  Serial.println("ESP32-C3 MQ-135 + AHT20/BMP280 + OLED + MicroSD monitor");
  Serial.println("MQ output is relative gas response, not ammonia ppm.");
  Serial.println("New MQ-135 modules need more than 48 hours of initial conditioning.");
  Serial.println("Type HELP with Newline selected in Serial Monitor.");

  analogReadResolution(12);
  analogSetPinAttenuation(MQ_ANALOG_PIN, ADC_11db);
  Wire.begin(I2C_SDA_PIN, I2C_SCL_PIN);
  oledReady = beginOled();
  if (oledReady) Serial.printf("SSD1306 OLED: connected at 0x%02X\n", oledAddress);
  else Serial.println("SSD1306 OLED: not detected (0x3C/0x3D)");
  ahtReady = aht20.begin(&Wire, 0, AHT20_ADDRESS);
  Serial.printf("AHT20 at 0x%02X: %s\n", AHT20_ADDRESS,
                ahtReady ? "connected" : "not detected");
  bmpReady = beginBmp280();
  if (bmpReady) Serial.printf("BMP280: connected at 0x%02X\n", bmpAddress);
  else Serial.println("BMP280: not detected (0x76/0x77)");
  SPI.begin(SD_SCK_PIN, SD_MISO_PIN, SD_MOSI_PIN, SD_CS_PIN);
  beginSdLog();
  loadCalibration();
  exportCalibration();
  startedMs = millis();
  takeReading();
  lastSampleMs = millis();
}

void loop() {
  readSerialCommands();
  serviceSdTransfer();
  const uint32_t now = millis();
  if (!sdReady && now - lastSdAttemptMs >= SD_RETRY_MS) beginSdLog();
  if (now - lastSampleMs >= SAMPLE_INTERVAL_MS) {
    lastSampleMs = now;
    takeReading();
  }
  delay(5);
}
