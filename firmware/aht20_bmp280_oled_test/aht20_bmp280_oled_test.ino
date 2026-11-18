#include <Arduino.h>
#include <Wire.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>
#include <Adafruit_AHTX0.h>
#include <Adafruit_BMP280.h>
#include <math.h>

// ESP32-C3 test for two modules sharing one I2C bus:
//   - 128x64 SSD1306 OLED
//   - Combined AHT20 + BMP280 temperature/humidity/pressure module

constexpr int I2C_SDA_PIN = 4;
constexpr int I2C_SCL_PIN = 5;

constexpr uint8_t OLED_WIDTH = 128;
constexpr uint8_t OLED_HEIGHT = 64;
constexpr int8_t OLED_RESET_PIN = -1;
constexpr uint8_t OLED_ADDRESS_1 = 0x3C;
constexpr uint8_t OLED_ADDRESS_2 = 0x3D;
constexpr uint8_t AHT20_ADDRESS = 0x38;
constexpr uint8_t BMP280_ADDRESS_1 = 0x76;
constexpr uint8_t BMP280_ADDRESS_2 = 0x77;

constexpr uint32_t READING_INTERVAL_MS = 2000;

Adafruit_SSD1306 display(OLED_WIDTH, OLED_HEIGHT, &Wire, OLED_RESET_PIN);
Adafruit_AHTX0 aht20;
Adafruit_BMP280 bmp280(&Wire);

bool oledReady = false;
bool ahtReady = false;
bool bmpReady = false;
uint8_t oledAddress = 0;
uint8_t bmpAddress = 0;
uint32_t lastReading = 0;

struct SensorReadings {
  float ahtTemperatureC = NAN;
  float humidityPercent = NAN;
  float bmpTemperatureC = NAN;
  float pressureHpa = NAN;
};

bool i2cDevicePresent(uint8_t address) {
  Wire.beginTransmission(address);
  return Wire.endTransmission() == 0;
}

void printHexAddress(uint8_t address) {
  Serial.print("0x");
  if (address < 0x10) {
    Serial.print('0');
  }
  Serial.print(address, HEX);
}

void scanI2CBus() {
  uint8_t deviceCount = 0;

  Serial.println("I2C scan:");
  for (uint8_t address = 1; address < 127; ++address) {
    Wire.beginTransmission(address);
    const uint8_t error = Wire.endTransmission();

    if (error == 0) {
      Serial.print("  Device found at ");
      printHexAddress(address);

      if (address == OLED_ADDRESS_1 || address == OLED_ADDRESS_2) {
        Serial.print(" (OLED)");
      } else if (address == AHT20_ADDRESS) {
        Serial.print(" (AHT20)");
      } else if (address == BMP280_ADDRESS_1 || address == BMP280_ADDRESS_2) {
        Serial.print(" (BMP280 possible address)");
      }
      Serial.println();
      ++deviceCount;
    }
  }

  Serial.print("I2C devices found: ");
  Serial.println(deviceCount);
}

bool beginOled() {
  if (i2cDevicePresent(OLED_ADDRESS_1)) {
    oledAddress = OLED_ADDRESS_1;
  } else if (i2cDevicePresent(OLED_ADDRESS_2)) {
    oledAddress = OLED_ADDRESS_2;
  } else {
    return false;
  }

  return display.begin(SSD1306_SWITCHCAPVCC, oledAddress, true, false);
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

SensorReadings readSensors() {
  SensorReadings readings;

  if (ahtReady) {
    sensors_event_t humidityEvent;
    sensors_event_t temperatureEvent;

    if (aht20.getEvent(&humidityEvent, &temperatureEvent)) {
      readings.ahtTemperatureC = temperatureEvent.temperature;
      readings.humidityPercent = humidityEvent.relative_humidity;
    }
  }

  if (bmpReady) {
    readings.bmpTemperatureC = bmp280.readTemperature();
    readings.pressureHpa = bmp280.readPressure() / 100.0f;
  }

  return readings;
}

void printReadingOrError(float value, uint8_t decimals) {
  if (isnan(value)) {
    display.print("ERR");
  } else {
    display.print(value, decimals);
  }
}

void showOnOled(const SensorReadings &readings) {
  if (!oledReady) {
    return;
  }

  display.clearDisplay();
  display.setTextColor(SSD1306_WHITE);
  display.setTextSize(1);

  display.setCursor(0, 0);
  display.println("AHT20 + BMP280 TEST");
  display.drawLine(0, 9, OLED_WIDTH - 1, 9, SSD1306_WHITE);

  display.setCursor(0, 14);
  display.print("AHT T: ");
  printReadingOrError(readings.ahtTemperatureC, 1);
  display.println(" C");

  display.setCursor(0, 25);
  display.print("AHT RH: ");
  printReadingOrError(readings.humidityPercent, 1);
  display.println(" %");

  display.setCursor(0, 36);
  display.print("BMP T: ");
  printReadingOrError(readings.bmpTemperatureC, 1);
  display.println(" C");

  display.setCursor(0, 47);
  display.print("Pressure: ");
  printReadingOrError(readings.pressureHpa, 1);
  display.println(" hPa");

  display.setCursor(0, 58);
  display.print("I2C ");
  display.print(oledReady ? "OLED" : "----");
  display.print(" ");
  display.print(ahtReady ? "AHT" : "---");
  display.print(" ");
  display.print(bmpReady ? "BMP" : "---");

  display.display();
}

void printToSerial(const SensorReadings &readings) {
  Serial.print("AHT20: ");
  if (isnan(readings.ahtTemperatureC) || isnan(readings.humidityPercent)) {
    Serial.print("ERROR");
  } else {
    Serial.print(readings.ahtTemperatureC, 2);
    Serial.print(" C, RH=");
    Serial.print(readings.humidityPercent, 2);
    Serial.print(" %");
  }

  Serial.print(" | BMP280: ");
  if (isnan(readings.bmpTemperatureC) || isnan(readings.pressureHpa)) {
    Serial.println("ERROR");
  } else {
    Serial.print(readings.bmpTemperatureC, 2);
    Serial.print(" C, pressure=");
    Serial.print(readings.pressureHpa, 2);
    Serial.println(" hPa");
  }
}

void showStartupStatus() {
  if (!oledReady) {
    return;
  }

  display.clearDisplay();
  display.setTextColor(SSD1306_WHITE);
  display.setTextSize(1);
  display.setCursor(0, 0);
  display.println("Sensor test starting");
  display.setCursor(0, 16);
  display.print("OLED: ");
  display.println("OK");
  display.setCursor(0, 28);
  display.print("AHT20: ");
  display.println(ahtReady ? "OK" : "ERROR");
  display.setCursor(0, 40);
  display.print("BMP280: ");
  display.println(bmpReady ? "OK" : "ERROR");
  display.display();
  delay(1500);
}

void setup() {
  Serial.begin(115200);

  const uint32_t serialWaitStart = millis();
  while (!Serial && millis() - serialWaitStart < 5000) {
    delay(10);
  }
  delay(100);

  Serial.println();
  Serial.println("ESP32-C3 combined AHT20+BMP280 + OLED test");
  Serial.print("I2C pins: SDA=GPIO");
  Serial.print(I2C_SDA_PIN);
  Serial.print(", SCL=GPIO");
  Serial.println(I2C_SCL_PIN);

#if defined(ARDUINO_ARCH_ESP32)
  Wire.begin(I2C_SDA_PIN, I2C_SCL_PIN);
#else
  Wire.begin();
#endif

  scanI2CBus();

  oledReady = beginOled();
  Serial.print("OLED ");
  printHexAddress(oledAddress);
  Serial.println(oledReady ? ": connected" : ": not detected");

  ahtReady = aht20.begin(&Wire, 0, AHT20_ADDRESS);
  Serial.print("AHT20 ");
  printHexAddress(AHT20_ADDRESS);
  Serial.println(ahtReady ? ": connected" : ": not detected");

  bmpReady = beginBmp280();
  Serial.print("BMP280 ");
  if (bmpReady) {
    printHexAddress(bmpAddress);
  } else {
    Serial.print("0x76/0x77");
  }
  Serial.println(bmpReady ? ": connected" : ": not detected");

  showStartupStatus();

  if (!oledReady && !ahtReady && !bmpReady) {
    Serial.println("No supported sensor/display detected. Check wiring.");
  }
}

void loop() {
  const uint32_t now = millis();
  if (now - lastReading < READING_INTERVAL_MS && lastReading != 0) {
    delay(5);
    return;
  }

  lastReading = now;
  const SensorReadings readings = readSensors();
  showOnOled(readings);
  printToSerial(readings);
}
