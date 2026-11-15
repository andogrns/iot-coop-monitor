#include <Arduino.h>
#include <Wire.h>
#include <Preferences.h>
#include <Adafruit_SHT31.h>
#include <math.h>

// Prototype program: MQ-135 + SHT31 only.
// No microSD, Wi-Fi, cloud connection, RTC, or battery measurement is used.

// ---------- Hardware configuration: keep in sync with calibration sketch ----
// Pin mapping used by the current prototype wiring: SHT31 SDA -> GPIO4 and
// SCL -> GPIO5. GPIO3 is kept for MQ-135 analog input (ADC1_CH3) so it does
// not conflict with the I2C lines.
constexpr int MQ_ANALOG_PIN = 3;
constexpr int I2C_SDA_PIN = 4;
constexpr int I2C_SCL_PIN = 5;
constexpr uint8_t SHT31_ADDRESS = 0x44;

// ESP32-C3 11 dB ADC input range is about 0-2.5 V. Use equal 10 kOhm
// resistors so a possible 5 V MQ module output becomes about 2.5 V at GPIO4.
// Replace this with the ratio calculated from the resistors you measure.
constexpr float MQ_DIVIDER_SCALE = 2.0f;
constexpr uint16_t ADC_WARNING_MV = 2400;

// Leave these at zero unless comparison with a trusted instrument supports an
// offset correction.
constexpr float TEMP_OFFSET_C = 0.0f;
constexpr float RH_OFFSET_PERCENT = 0.0f;

constexpr uint32_t SAMPLE_INTERVAL_MS = 2000;
constexpr uint32_t MQ_STABILIZATION_MS = 10UL * 60UL * 1000UL;
constexpr uint8_t WARNING_CONFIRMATION_SAMPLES = 3;
constexpr bool MQ_WARNING_ON_RISING_VOLTAGE = true;

constexpr char PREF_NAMESPACE[] = "coopcal";
constexpr uint16_t CALIBRATION_VERSION = 1;

Adafruit_SHT31 sht31 = Adafruit_SHT31();
Preferences preferences;

bool shtReady = false;
bool calibrationValid = false;
float mqBaselineMv = NAN;
float mqThresholdMv = NAN;
uint8_t warningStreak = 0;
uint32_t startedMs = 0;
uint32_t lastSampleMs = 0;
uint32_t sampleNumber = 0;

struct MqReading {
  uint16_t raw;
  uint16_t adcMilliVolts;
  float moduleVolts;
};

MqReading readMqAveraged() {
  constexpr uint8_t READING_COUNT = 32;
  uint32_t rawTotal = 0;
  uint32_t milliVoltTotal = 0;

  for (uint8_t i = 0; i < READING_COUNT; ++i) {
    rawTotal += analogRead(MQ_ANALOG_PIN);
    milliVoltTotal += analogReadMilliVolts(MQ_ANALOG_PIN);
    delay(2);
  }

  MqReading reading;
  reading.raw = rawTotal / READING_COUNT;
  reading.adcMilliVolts = milliVoltTotal / READING_COUNT;
  reading.moduleVolts = (reading.adcMilliVolts / 1000.0f) * MQ_DIVIDER_SCALE;
  return reading;
}

bool readSht31(float &temperatureC, float &humidityPercent) {
  if (!shtReady) {
    temperatureC = NAN;
    humidityPercent = NAN;
    return false;
  }

  temperatureC = sht31.readTemperature();
  humidityPercent = sht31.readHumidity();
  if (isnan(temperatureC) || isnan(humidityPercent)) {
    return false;
  }

  temperatureC += TEMP_OFFSET_C;
  humidityPercent = constrain(humidityPercent + RH_OFFSET_PERCENT, 0.0f, 100.0f);
  return true;
}

void loadCalibration() {
  preferences.begin(PREF_NAMESPACE, true);
  calibrationValid = preferences.getBool("valid", false) &&
                     preferences.getUShort("version", 0) == CALIBRATION_VERSION;
  mqBaselineMv = preferences.getFloat("base_mv", NAN);
  mqThresholdMv = preferences.getFloat("thr_mv", NAN);
  preferences.end();

  calibrationValid = calibrationValid && !isnan(mqBaselineMv) &&
                     !isnan(mqThresholdMv) && mqBaselineMv > 0.0f &&
                     mqThresholdMv > 0.0f;
}

String addStatus(String status, const char *flag) {
  if (status.length() > 0) {
    status += "|";
  }
  status += flag;
  return status;
}

void printColumnHeader() {
  Serial.println("sample,uptime_s,mq_raw,mq_adc_mv,mq_module_v,mq_ratio,temp_c,rh_percent,status");
}

void printPrototypeStatus() {
  Serial.println("\nPrototype status:");
  Serial.printf("  MQ-135 ADC pin: GPIO %d\n", MQ_ANALOG_PIN);
  Serial.printf("  SHT31: %s\n", shtReady ? "connected" : "not detected");
  if (calibrationValid) {
    Serial.printf("  MQ clean-air baseline: %.1f mV at ADC\n", mqBaselineMv);
    Serial.printf("  MQ warning threshold: %.1f mV at ADC\n", mqThresholdMv);
  } else {
    Serial.println("  MQ calibration: not found; raw readings still work, warnings are disabled");
  }
  Serial.println("  Data logging: disabled for this prototype phase");
  Serial.println();
}

void takeAndDisplayReading() {
  ++sampleNumber;
  const uint32_t uptimeSeconds = (millis() - startedMs) / 1000UL;
  const MqReading mq = readMqAveraged();

  float temperatureC;
  float humidityPercent;
  const bool shtValid = readSht31(temperatureC, humidityPercent);

  String status;
  const bool warmingUp = millis() - startedMs < MQ_STABILIZATION_MS;
  if (warmingUp) {
    status = addStatus(status, "WARMUP");
    warningStreak = 0;
  }
  if (!calibrationValid) {
    status = addStatus(status, "CAL_MISSING");
    warningStreak = 0;
  }
  if (!shtValid) {
    status = addStatus(status, "SHT_ERROR");
  }
  if (mq.adcMilliVolts >= ADC_WARNING_MV) {
    status = addStatus(status, "MQ_ADC_HIGH");
  }

  if (!warmingUp && calibrationValid) {
    const bool warningLevel = MQ_WARNING_ON_RISING_VOLTAGE
                                  ? mq.adcMilliVolts >= mqThresholdMv
                                  : mq.adcMilliVolts <= mqThresholdMv;
    if (warningLevel) {
      if (warningStreak < 255) {
        ++warningStreak;
      }
    } else {
      warningStreak = 0;
    }

    if (warningStreak >= WARNING_CONFIRMATION_SAMPLES) {
      status = addStatus(status, "GAS_WARNING");
    }
  }

  if (status.length() == 0) {
    status = "OK";
  }

  // Repeat the header occasionally so long Serial Monitor sessions stay clear.
  if (sampleNumber == 1 || sampleNumber % 30 == 0) {
    printColumnHeader();
  }

  Serial.printf("%lu,%lu,%u,%u,%.3f,",
                sampleNumber, uptimeSeconds, mq.raw,
                mq.adcMilliVolts, mq.moduleVolts);

  if (calibrationValid) {
    Serial.print(mq.adcMilliVolts / mqBaselineMv, 4);
  }
  Serial.print(',');
  if (shtValid) {
    Serial.print(temperatureC, 2);
  }
  Serial.print(',');
  if (shtValid) {
    Serial.print(humidityPercent, 2);
  }
  Serial.print(',');
  Serial.println(status);
}

void setup() {
  Serial.begin(115200);
  delay(1200);
  Serial.println("\nPoultry-coop MQ-135 + SHT31 prototype");
  Serial.println("Readings are displayed only; no measurements are being saved.");
  Serial.println("MQ-135 output is a relative gas response, not ammonia ppm.");

  analogReadResolution(12);
  analogSetPinAttenuation(MQ_ANALOG_PIN, ADC_11db);

  Wire.begin(I2C_SDA_PIN, I2C_SCL_PIN);
  // This installed Adafruit_SHT31 library selects the Wire bus in the
  // constructor, so begin() receives only the sensor address.
  shtReady = sht31.begin(SHT31_ADDRESS);
  loadCalibration();

  startedMs = millis();
  printPrototypeStatus();
  takeAndDisplayReading();
  lastSampleMs = millis();
}

void loop() {
  const uint32_t now = millis();
  if (now - lastSampleMs >= SAMPLE_INTERVAL_MS) {
    lastSampleMs = now;
    takeAndDisplayReading();
  }
  delay(5);
}

/*
  FUTURE LOCAL LOGGING (intentionally disabled)
  ------------------------------------------------
  When the sensor-only prototype is working reliably, local logging can be
  added without changing the sensor functions above. The later version can:

  1. Add #include <SPI.h> and #include <SD.h> at the top.
  2. Configure the microSD CS, SCK, MISO, and MOSI pins.
  3. Call SD.begin(...) in setup().
  4. Open /coop_log.csv with FILE_APPEND inside takeAndDisplayReading().
  5. Write the same comma-separated line printed to Serial, then flush and
     close the file so a sudden power loss affects at most one record.

  Example outline (not compiled):

    File logFile = SD.open("/coop_log.csv", FILE_APPEND);
    if (logFile) {
      logFile.printf("%lu,%lu,%u,%u,%.3f,%.2f,%.2f,%s\n",
                     sampleNumber, uptimeSeconds, mq.raw,
                     mq.adcMilliVolts, mq.moduleVolts,
                     temperatureC, humidityPercent, status.c_str());
      logFile.flush();
      logFile.close();
    }

  Do not enable this section until the microSD module and its 3.3 V logic
  compatibility have been verified.
*/
