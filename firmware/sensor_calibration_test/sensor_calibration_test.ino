#include <Arduino.h>
#include <Wire.h>
#include <Preferences.h>
#include <Adafruit_SHT31.h>
#include <math.h>

// ---------- Hardware configuration: edit to match the actual board ----------
// Pin mapping used by the current prototype wiring: SHT31 SDA -> GPIO4 and
// SCL -> GPIO5. GPIO3 is kept for MQ-135 analog input (ADC1_CH3) so it does
// not conflict with the I2C lines.
constexpr int MQ_ANALOG_PIN = 3;
constexpr int I2C_SDA_PIN = 4;
constexpr int I2C_SCL_PIN = 5;
constexpr uint8_t SHT31_ADDRESS = 0x44;

// 10 kOhm from MQ AO to ADC and 10 kOhm from ADC to GND -> (10k+10k)/10k.
// Replace this with the ratio calculated from the resistors you measure.
// ESP32-C3 11 dB ADC input range is about 0-2.5 V. Use equal 10 kOhm
// resistors so a possible 5 V MQ module output becomes about 2.5 V at GPIO4.
constexpr float MQ_DIVIDER_SCALE = 2.0f;
constexpr uint16_t ADC_WARNING_MV = 2400;

// SHT31 offsets must stay zero unless comparison with a trusted reference
// instrument supports a correction.
constexpr float TEMP_OFFSET_C = 0.0f;
constexpr float RH_OFFSET_PERCENT = 0.0f;

constexpr uint32_t LIVE_SAMPLE_INTERVAL_MS = 2000;
constexpr uint32_t STABILIZATION_MS = 10UL * 60UL * 1000UL;
constexpr uint32_t BASELINE_COLLECTION_MS = 5UL * 60UL * 1000UL;
constexpr float ALERT_RISE_FRACTION = 0.15f;
constexpr float ALERT_SIGMA_MULTIPLIER = 3.0f;
constexpr uint32_t MIN_BASELINE_SAMPLES = 60;

constexpr char PREF_NAMESPACE[] = "coopcal";
constexpr uint16_t CALIBRATION_VERSION = 1;

Adafruit_SHT31 sht31 = Adafruit_SHT31();
Preferences preferences;

bool shtReady = false;

enum class CalibrationState { STABILIZING, COLLECTING, COMPLETE };
CalibrationState calibrationState = CalibrationState::STABILIZING;
uint32_t stateStartedMs = 0;
uint32_t lastSampleMs = 0;

struct MqReading {
  uint16_t raw;
  uint16_t adcMilliVolts;
  float moduleVolts;
};

struct RunningStats {
  uint32_t count = 0;
  double mean = 0.0;
  double m2 = 0.0;

  void clear() {
    count = 0;
    mean = 0.0;
    m2 = 0.0;
  }

  void add(double value) {
    ++count;
    const double delta = value - mean;
    mean += delta / count;
    const double delta2 = value - mean;
    m2 += delta * delta2;
  }

  double standardDeviation() const {
    return count > 1 ? sqrt(m2 / (count - 1)) : 0.0;
  }
};

RunningStats mqRawStats;
RunningStats mqMvStats;
RunningStats temperatureStats;
RunningStats humidityStats;

MqReading readMqAveraged() {
  constexpr uint8_t SAMPLE_COUNT = 32;
  uint32_t rawTotal = 0;
  uint32_t milliVoltTotal = 0;

  for (uint8_t i = 0; i < SAMPLE_COUNT; ++i) {
    rawTotal += analogRead(MQ_ANALOG_PIN);
    milliVoltTotal += analogReadMilliVolts(MQ_ANALOG_PIN);
    delay(2);
  }

  MqReading reading;
  reading.raw = rawTotal / SAMPLE_COUNT;
  reading.adcMilliVolts = milliVoltTotal / SAMPLE_COUNT;
  reading.moduleVolts = (reading.adcMilliVolts / 1000.0f) * MQ_DIVIDER_SCALE;
  return reading;
}

bool readSht(float &temperatureC, float &humidityPercent) {
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

void scanI2cBus() {
  Serial.println("\nI2C scan:");
  uint8_t found = 0;
  for (uint8_t address = 1; address < 127; ++address) {
    Wire.beginTransmission(address);
    if (Wire.endTransmission() == 0) {
      Serial.printf("  Found device at 0x%02X%s\n", address,
                    address == SHT31_ADDRESS ? " (configured SHT31)" : "");
      ++found;
    }
  }
  if (found == 0) {
    Serial.println("  ERROR: no I2C devices found.");
  }
}

void printSavedCalibration() {
  preferences.begin(PREF_NAMESPACE, true);
  const bool valid = preferences.getBool("valid", false);
  if (!valid) {
    Serial.println("Saved calibration: none");
    preferences.end();
    return;
  }

  Serial.println("Saved calibration:");
  Serial.printf("  version: %u\n", preferences.getUShort("version", 0));
  Serial.printf("  samples: %lu\n", preferences.getUInt("samples", 0));
  Serial.printf("  MQ baseline: %.1f raw, %.1f mV at ADC\n",
                preferences.getFloat("base_raw", NAN),
                preferences.getFloat("base_mv", NAN));
  Serial.printf("  MQ standard deviation: %.1f raw, %.1f mV\n",
                preferences.getFloat("sd_raw", NAN),
                preferences.getFloat("sd_mv", NAN));
  Serial.printf("  initial warning threshold: %.1f mV at ADC\n",
                preferences.getFloat("thr_mv", NAN));
  Serial.printf("  calibration environment: %.2f C, %.2f %%RH\n",
                preferences.getFloat("cal_temp", NAN),
                preferences.getFloat("cal_rh", NAN));
  preferences.end();
}

void startCalibration() {
  mqRawStats.clear();
  mqMvStats.clear();
  temperatureStats.clear();
  humidityStats.clear();
  calibrationState = CalibrationState::STABILIZING;
  stateStartedMs = millis();
  Serial.println("\nCalibration restarted.");
  Serial.println("Keep the conditioned MQ-135 in clean, stable reference air.");
  Serial.printf("Stabilizing for %lu minutes, then collecting for %lu minutes.\n",
                STABILIZATION_MS / 60000UL, BASELINE_COLLECTION_MS / 60000UL);
}

void saveCalibration() {
  if (mqMvStats.count < MIN_BASELINE_SAMPLES) {
    Serial.printf("CALIBRATION FAILED: only %lu samples; at least %lu required.\n",
                  mqMvStats.count, MIN_BASELINE_SAMPLES);
    startCalibration();
    return;
  }

  const float baselineMv = mqMvStats.mean;
  const float sdMv = mqMvStats.standardDeviation();
  if (baselineMv < 10.0f || baselineMv >= ADC_WARNING_MV) {
    Serial.printf("CALIBRATION FAILED: MQ baseline %.1f mV is outside the safe/useful ADC range.\n",
                  baselineMv);
    Serial.println("Disconnect power and check the MQ supply, common ground, divider, and AO wiring.");
    calibrationState = CalibrationState::COMPLETE;
    return;
  }
  const float percentageThreshold = baselineMv * (1.0f + ALERT_RISE_FRACTION);
  const float statisticalThreshold = baselineMv + ALERT_SIGMA_MULTIPLIER * sdMv;
  const float warningThresholdMv = max(percentageThreshold, statisticalThreshold);

  preferences.begin(PREF_NAMESPACE, false);
  preferences.putBool("valid", true);
  preferences.putUShort("version", CALIBRATION_VERSION);
  preferences.putUInt("samples", mqMvStats.count);
  preferences.putFloat("base_raw", mqRawStats.mean);
  preferences.putFloat("sd_raw", mqRawStats.standardDeviation());
  preferences.putFloat("base_mv", baselineMv);
  preferences.putFloat("sd_mv", sdMv);
  preferences.putFloat("thr_mv", warningThresholdMv);
  preferences.putFloat("cal_temp", temperatureStats.count ? temperatureStats.mean : NAN);
  preferences.putFloat("cal_rh", humidityStats.count ? humidityStats.mean : NAN);
  preferences.end();

  calibrationState = CalibrationState::COMPLETE;
  Serial.println("\n================ CALIBRATION SAVED ================");
  printSavedCalibration();
  Serial.println("This is a trend baseline, not an ammonia ppm calibration.");
  Serial.println("Upload the offline logger only after reviewing these values.");
  Serial.println("===================================================\n");
}

void printHelp() {
  Serial.println("Commands: c = restart calibration, p = print saved calibration, h = help");
}

void handleSerialCommands() {
  while (Serial.available()) {
    const char command = tolower(Serial.read());
    if (command == 'c') {
      startCalibration();
    } else if (command == 'p') {
      printSavedCalibration();
    } else if (command == 'h' || command == '?') {
      printHelp();
    }
  }
}

void setup() {
  Serial.begin(115200);
  delay(1200);
  Serial.println("\nPoultry-coop sensor calibration and hardware test");
  Serial.println("IMPORTANT: condition a new MQ-135 continuously for at least 48 hours first.");
  Serial.println("MQ output is calibrated as a relative clean-air baseline, not ammonia ppm.");

  analogReadResolution(12);
  analogSetPinAttenuation(MQ_ANALOG_PIN, ADC_11db);

  Wire.begin(I2C_SDA_PIN, I2C_SCL_PIN);
  scanI2cBus();
  // This installed Adafruit_SHT31 library selects the Wire bus in the
  // constructor, so begin() receives only the sensor address.
  shtReady = sht31.begin(SHT31_ADDRESS);
  Serial.printf("SHT31 test: %s\n", shtReady ? "PASSED" : "FAILED");

  printSavedCalibration();
  printHelp();
  startCalibration();
}

void loop() {
  handleSerialCommands();
  const uint32_t now = millis();
  if (now - lastSampleMs < LIVE_SAMPLE_INTERVAL_MS) {
    delay(5);
    return;
  }
  lastSampleMs = now;

  const MqReading mq = readMqAveraged();
  float temperatureC;
  float humidityPercent;
  const bool shtValid = readSht(temperatureC, humidityPercent);

  const char *stateText = calibrationState == CalibrationState::STABILIZING
                              ? "STABILIZING"
                              : calibrationState == CalibrationState::COLLECTING
                                    ? "COLLECTING"
                                    : "COMPLETE";
  Serial.printf("%10lu ms,%s,MQ=%u raw,%u mV ADC,%.3f V module,",
                now, stateText, mq.raw, mq.adcMilliVolts, mq.moduleVolts);
  if (shtValid) {
    Serial.printf("T=%.2f C,RH=%.2f %%", temperatureC, humidityPercent);
  } else {
    Serial.print("T=ERROR,RH=ERROR");
  }
  if (mq.adcMilliVolts >= ADC_WARNING_MV) {
    Serial.print(",WARNING: ADC voltage too high");
  }
  Serial.println();

  if (calibrationState == CalibrationState::STABILIZING) {
    if (now - stateStartedMs >= STABILIZATION_MS) {
      calibrationState = CalibrationState::COLLECTING;
      stateStartedMs = now;
      Serial.println("\nStabilization complete; baseline collection started.");
      Serial.println("Do not move or expose the sensors to gas during collection.\n");
    }
    return;
  }

  if (calibrationState == CalibrationState::COLLECTING) {
    mqRawStats.add(mq.raw);
    mqMvStats.add(mq.adcMilliVolts);
    if (shtValid) {
      temperatureStats.add(temperatureC);
      humidityStats.add(humidityPercent);
    }

    if (now - stateStartedMs >= BASELINE_COLLECTION_MS) {
      saveCalibration();
    }
  }
}
