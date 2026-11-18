#include <Arduino.h>
#include <Wire.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>

// Standalone 128x64 I2C OLED / SSD1306 detection and display test.
// The sketch scans the I2C bus, tries the common OLED addresses (0x3C and
// 0x3D), and then displays several test screens.

constexpr uint8_t OLED_WIDTH = 128;
constexpr uint8_t OLED_HEIGHT = 64;
constexpr int8_t OLED_RESET_PIN = -1;  // Most I2C modules do not expose reset.

// Set these for the ESP32-C3 prototype. For an Arduino Uno/Nano, the sketch
// uses the board's default SDA/SCL pins instead.
constexpr int I2C_SDA_PIN = 4;
constexpr int I2C_SCL_PIN = 5;

constexpr uint8_t OLED_ADDRESS_1 = 0x3C;
constexpr uint8_t OLED_ADDRESS_2 = 0x3D;
constexpr uint32_t SCREEN_INTERVAL_MS = 2000;
constexpr uint32_t SERIAL_HEARTBEAT_MS = 2000;

Adafruit_SSD1306 display(OLED_WIDTH, OLED_HEIGHT, &Wire, OLED_RESET_PIN);

uint8_t oledAddress = 0;
uint8_t screenNumber = 0;
uint32_t lastScreenChange = 0;
uint32_t lastSerialHeartbeat = 0;

bool i2cDevicePresent(uint8_t address) {
  Wire.beginTransmission(address);
  return Wire.endTransmission() == 0;
}

void scanI2CBus() {
  uint8_t deviceCount = 0;

  Serial.println("I2C scan:");
  for (uint8_t address = 1; address < 127; ++address) {
    Wire.beginTransmission(address);
    const uint8_t error = Wire.endTransmission();

    if (error == 0) {
      Serial.print("  Device found at 0x");
      if (address < 0x10) {
        Serial.print('0');
      }
      Serial.print(address, HEX);
      if (address == OLED_ADDRESS_1 || address == OLED_ADDRESS_2) {
        Serial.print(" (common SSD1306 OLED address)");
      }
      Serial.println();
      ++deviceCount;
    } else if (error == 4) {
      Serial.print("  Unknown error at 0x");
      if (address < 0x10) {
        Serial.print('0');
      }
      Serial.println(address, HEX);
    }
  }

  if (deviceCount == 0) {
    Serial.println("  No I2C devices found.");
  } else {
    Serial.print("I2C scan complete: ");
    Serial.print(deviceCount);
    Serial.println(" device(s).");
  }
}

bool beginOled() {
  if (i2cDevicePresent(OLED_ADDRESS_1)) {
    oledAddress = OLED_ADDRESS_1;
  } else if (i2cDevicePresent(OLED_ADDRESS_2)) {
    oledAddress = OLED_ADDRESS_2;
  } else {
    return false;
  }

  // Keep the existing Wire configuration. The final false prevents the
  // library from reinitializing the bus with its default pins.
  if (!display.begin(SSD1306_SWITCHCAPVCC, oledAddress, true, false)) {
    oledAddress = 0;
    return false;
  }

  return true;
}

void showTitle(const char *title, const char *subtitle) {
  display.clearDisplay();
  display.setTextColor(SSD1306_WHITE);
  display.setTextSize(1);
  display.setCursor(0, 0);
  display.println(title);
  display.drawLine(0, 10, OLED_WIDTH - 1, 10, SSD1306_WHITE);
  display.setCursor(0, 18);
  display.println(subtitle);
}

void showTextTest() {
  showTitle("SSD1306 OLED TEST", "Text and address check");
  display.setCursor(0, 34);
  display.print("I2C address: 0x");
  display.println(oledAddress, HEX);
  display.setCursor(0, 46);
  display.println("128 x 64 pixels");
  display.setCursor(0, 56);
  display.println("PASS: display initialized");
  display.display();
}

void showShapeTest() {
  display.clearDisplay();
  display.drawRect(0, 0, OLED_WIDTH, OLED_HEIGHT, SSD1306_WHITE);
  display.drawRect(4, 4, OLED_WIDTH - 8, OLED_HEIGHT - 8, SSD1306_WHITE);
  display.drawLine(8, 8, OLED_WIDTH - 9, OLED_HEIGHT - 9, SSD1306_WHITE);
  display.drawLine(OLED_WIDTH - 9, 8, 8, OLED_HEIGHT - 9, SSD1306_WHITE);
  display.fillCircle(OLED_WIDTH / 2, OLED_HEIGHT / 2, 12, SSD1306_WHITE);
  display.drawCircle(OLED_WIDTH / 2, OLED_HEIGHT / 2, 18, SSD1306_WHITE);
  display.display();
}

void showCheckerboardTest() {
  display.clearDisplay();
  constexpr uint8_t blockSize = 8;
  for (uint8_t y = 0; y < OLED_HEIGHT / blockSize; ++y) {
    for (uint8_t x = 0; x < OLED_WIDTH / blockSize; ++x) {
      if ((x + y) % 2 == 0) {
        display.fillRect(x * blockSize, y * blockSize,
                         blockSize, blockSize, SSD1306_WHITE);
      }
    }
  }
  display.display();
}

void showProgressTest() {
  display.clearDisplay();
  display.setTextColor(SSD1306_WHITE);
  display.setTextSize(1);
  display.setCursor(0, 0);
  display.println("Brightness / pixels");

  for (uint8_t row = 0; row < 4; ++row) {
    const uint8_t y = 18 + row * 10;
    display.drawRect(0, y, OLED_WIDTH, 7, SSD1306_WHITE);
    display.fillRect(2, y + 2, (row + 1) * 30, 3, SSD1306_WHITE);
  }
  display.display();
}

void showNextScreen() {
  switch (screenNumber % 4) {
    case 0:
      showTextTest();
      break;
    case 1:
      showShapeTest();
      break;
    case 2:
      showCheckerboardTest();
      break;
    case 3:
      showProgressTest();
      break;
  }
  ++screenNumber;
}

void showFailureMessage() {
  display.clearDisplay();
  display.setTextColor(SSD1306_WHITE);
  display.setTextSize(1);
  display.setCursor(0, 0);
  display.println("OLED NOT FOUND");
  display.setCursor(0, 16);
  display.println("Check wiring and power");
  display.setCursor(0, 28);
  display.println("Try address 0x3C/0x3D");
  display.setCursor(0, 40);
  display.println("SDA GPIO4  SCL GPIO5");
  display.display();
}

void setup() {
  Serial.begin(115200);

  // ESP32-C3 boards using native USB can enumerate the serial port after the
  // sketch starts. Wait briefly so startup diagnostics are not lost, but do
  // not block forever when using a hardware USB-to-UART adapter.
  const uint32_t serialWaitStart = millis();
  while (!Serial && millis() - serialWaitStart < 5000) {
    delay(10);
  }
  delay(100);

  Serial.println();
  Serial.println("128x64 I2C SSD1306 OLED test");

#if defined(ARDUINO_ARCH_ESP32)
  Wire.begin(I2C_SDA_PIN, I2C_SCL_PIN);
  Serial.print("I2C pins: SDA=GPIO");
  Serial.print(I2C_SDA_PIN);
  Serial.print(", SCL=GPIO");
  Serial.println(I2C_SCL_PIN);
#else
  Wire.begin();
  Serial.println("I2C pins: board defaults");
#endif

  scanI2CBus();

  if (!beginOled()) {
    Serial.println("SSD1306 OLED: NOT DETECTED");
    Serial.println("Check VCC, GND, SDA, SCL, and the module address.");
    return;
  }

  Serial.print("SSD1306 OLED: detected at 0x");
  if (oledAddress < 0x10) {
    Serial.print('0');
  }
  Serial.println(oledAddress, HEX);
  Serial.println("Running text, shape, checkerboard, and progress tests.");
  showNextScreen();
  lastScreenChange = millis();
  lastSerialHeartbeat = millis();
}

void loop() {
  if (oledAddress == 0) {
    // Keep the serial monitor useful if the module is connected after boot.
    delay(1000);
    scanI2CBus();
    if (beginOled()) {
      Serial.print("SSD1306 OLED connected at 0x");
      if (oledAddress < 0x10) {
        Serial.print('0');
      }
      Serial.println(oledAddress, HEX);
      showNextScreen();
      lastScreenChange = millis();
      lastSerialHeartbeat = millis();
    }
    return;
  }

  const uint32_t now = millis();
  if (now - lastScreenChange >= SCREEN_INTERVAL_MS) {
    lastScreenChange = now;
    showNextScreen();
  }

  if (now - lastSerialHeartbeat >= SERIAL_HEARTBEAT_MS) {
    lastSerialHeartbeat = now;
    Serial.print("Heartbeat: sketch running; OLED=0x");
    if (oledAddress < 0x10) {
      Serial.print('0');
    }
    Serial.println(oledAddress, HEX);
  }
}
