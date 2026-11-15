#include <Arduino.h>
#include <Wire.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>
#include <Adafruit_AHTX0.h>
#include <Adafruit_BMP280.h>
#include <math.h>

// ESP32-C3 SuperMini sensor display prototype.
// Shared I2C bus: OLED + AHT20 + BMP280.

// ---------- Pin and address configuration ----------
constexpr int I2C_SDA_PIN = 4;
constexpr int I2C_SCL_PIN = 5;
constexpr int MQ_ANALOG_PIN = 3;

constexpr uint8_t OLED_ADDRESS = 0x3C;  // Common SSD1306 address; try 0x3D if blank.
constexpr uint8_t AHT20_ADDRESS = 0x38;
constexpr uint8_t BMP280_ADDRESS_PRIMARY = 0x76;
constexpr uint8_t BMP280_ADDRESS_SECONDARY = 0x77;

constexpr int OLED_WIDTH = 128;
constexpr int OLED_HEIGHT = 64;
constexpr int OLED_RESET = -1;  // Most I2C OLED modules have no separate reset pin.

// Equal 10 kOhm resistors: MQ AO -> R1 -> GPIO3 -> R2 -> GND.
// The ESP32-C3 ADC sees half the MQ module voltage.
constexpr float MQ_DIVIDER_SCALE = 2.0f;
constexpr uint16_t MQ_ADC_WARNING_MV = 2400;

constexpr uint32_t DISPLAY_INTERVAL_MS = 1000;
constexpr uint32_t SERIAL_INTERVAL_MS = 2000;

Adafruit_SSD1306 display(OLED_WIDTH, OLED_HEIGHT, &Wire, OLED_RESET);
Adafruit_AHTX0 aht20;
Adafruit_BMP280 bmp280(&Wire);

bool oledReady = false;
bool ahtReady = false;
bool bmpReady = false;
uint8_t bmpAddressUsed = 0;
uint32_t lastDisplayMs = 0;
uint32_t lastSerialMs = 0;

struct SensorValues {
  uint16_t mqRaw = 0;
  uint16_t mqAdcMilliVolts = 0;
  float mqModuleVolts = NAN;
  float ahtTemperatureC = NAN;
  float humidityPercent = NAN;
  float bmpTemperatureC = NAN;
  float pressureHpa = NAN;
};

bool i2cPresent(uint8_t address) {
  Wire.beginTransmission(address);
  return Wire.endTransmission() == 0;
}

SensorValues readSensors() {
  SensorValues values;

  // Average the MQ analog input to make the OLED value less jumpy.
  constexpr uint8_t MQ_SAMPLES = 16;
  uint32_t rawTotal = 0;
  uint32_t milliVoltTotal = 0;
  for (uint8_t i = 0; i < MQ_SAMPLES; ++i) {
    rawTotal += analogRead(MQ_ANALOG_PIN);
    milliVoltTotal += analogReadMilliVolts(MQ_ANALOG_PIN);
    delay(2);
  }
  values.mqRaw = rawTotal / MQ_SAMPLES;
  values.mqAdcMilliVolts = milliVoltTotal / MQ_SAMPLES;
  values.mqModuleVolts = values.mqAdcMilliVolts / 1000.0f * MQ_DIVIDER_SCALE;

  if (ahtReady) {
    sensors_event_t humidityEvent;
    sensors_event_t temperatureEvent;
    if (aht20.getEvent(&humidityEvent, &temperatureEvent)) {
      values.ahtTemperatureC = temperatureEvent.temperature;
      values.humidityPercent = humidityEvent.relative_humidity;
    }
  }

  if (bmpReady) {
    values.bmpTemperatureC = bmp280.readTemperature();
    values.pressureHpa = bmp280.readPressure() / 100.0f;
  }

  return values;
}

void printValueOrError(float value, uint8_t decimals) {
  if (isnan(value)) {
    display.print("ERR");
  } else {
    display.print(value, decimals);
  }
}

void showOnOled(const SensorValues &values) {
  if (!oledReady) {
    return;
  }

  display.clearDisplay();
  display.setTextColor(SSD1306_WHITE);
  display.setTextSize(1);
  display.setCursor(0, 0);
  display.println("Poultry sensor test");

  display.setCursor(0, 11);
  display.print("AHT T: ");
  printValueOrError(values.ahtTemperatureC, 1);
  display.println(" C");

  display.setCursor(0, 21);
  display.print("AHT RH: ");
  printValueOrError(values.humidityPercent, 1);
  display.println(" %");

  display.setCursor(0, 31);
  display.print("BMP T: ");
  printValueOrError(values.bmpTemperatureC, 1);
  display.println(" C");

  display.setCursor(0, 41);
  display.print("Pressure: ");
  printValueOrError(values.pressureHpa, 1);
  display.println(" hPa");

  display.setCursor(0, 51);
  display.print("MQ: ");
  display.print(values.mqAdcMilliVolts);
  display.print("mV");
  if (values.mqAdcMilliVolts >= MQ_ADC_WARNING_MV) {
    display.print(" HIGH");
  }

  display.display();
}

void printToSerial(const SensorValues &values) {
  Serial.printf("MQ raw=%u, ADC=%u mV, module=%.3f V, ",
                values.mqRaw, values.mqAdcMilliVolts, values.mqModuleVolts);
  if (isnan(values.ahtTemperatureC)) {
    Serial.print("AHT=ERROR, RH=ERROR, ");
  } else {
    Serial.printf("AHT=%.2f C, RH=%.2f %%, ",
                  values.ahtTemperatureC, values.humidityPercent);
  }
  if (isnan(values.bmpTemperatureC) || isnan(values.pressureHpa)) {
    Serial.println("BMP=ERROR");
  } else {
    Serial.printf("BMP=%.2f C, pressure=%.2f hPa%s\n",
                  values.bmpTemperatureC, values.pressureHpa,
                  values.mqAdcMilliVolts >= MQ_ADC_WARNING_MV ? " [MQ ADC HIGH]" : "");
  }
}

void setup() {
  Serial.begin(115200);
  delay(1200);
  Serial.println("\nESP32-C3 SuperMini OLED sensor display");
  Serial.println("I2C: SDA=GPIO4, SCL=GPIO5");

  analogReadResolution(12);
  analogSetPinAttenuation(MQ_ANALOG_PIN, ADC_11db);
  Wire.begin(I2C_SDA_PIN, I2C_SCL_PIN);

  if (i2cPresent(OLED_ADDRESS)) {
    // Wire was already started with GPIO4/GPIO5, so do not let the display
    // library reinitialize the bus with different default pins.
    oledReady = display.begin(SSD1306_SWITCHCAPVCC, OLED_ADDRESS, true, false);
  }
  Serial.printf("OLED 0x%02X: %s\n", OLED_ADDRESS, oledReady ? "connected" : "not detected");

  ahtReady = aht20.begin(&Wire, 0, AHT20_ADDRESS);
  Serial.printf("AHT20 0x%02X: %s\n", AHT20_ADDRESS, ahtReady ? "connected" : "not detected");

  if (i2cPresent(BMP280_ADDRESS_PRIMARY)) {
    bmpAddressUsed = BMP280_ADDRESS_PRIMARY;
    bmpReady = bmp280.begin(BMP280_ADDRESS_PRIMARY);
  } else if (i2cPresent(BMP280_ADDRESS_SECONDARY)) {
    bmpAddressUsed = BMP280_ADDRESS_SECONDARY;
    bmpReady = bmp280.begin(BMP280_ADDRESS_SECONDARY);
  }
  Serial.printf("BMP280: %s", bmpReady ? "connected" : "not detected");
  if (bmpReady) {
    Serial.printf(" at 0x%02X", bmpAddressUsed);
    bmp280.setSampling(Adafruit_BMP280::MODE_NORMAL,
                       Adafruit_BMP280::SAMPLING_X2,
                       Adafruit_BMP280::SAMPLING_X16,
                       Adafruit_BMP280::FILTER_X4,
                       Adafruit_BMP280::STANDBY_MS_500);
  }
  Serial.println();

  if (oledReady) {
    display.clearDisplay();
    display.setTextColor(SSD1306_WHITE);
    display.setTextSize(1);
    display.setCursor(0, 0);
    display.println("Starting sensors...");
    display.display();
    delay(1000);
  }
}

void loop() {
  const uint32_t now = millis();
  if (now - lastDisplayMs >= DISPLAY_INTERVAL_MS || lastDisplayMs == 0) {
    lastDisplayMs = now;
    const SensorValues values = readSensors();
    showOnOled(values);
    if (now - lastSerialMs >= SERIAL_INTERVAL_MS || lastSerialMs == 0) {
      lastSerialMs = now;
      printToSerial(values);
    }
  }
  delay(5);
}
