# 128x64 I2C SSD1306 OLED test

This standalone Arduino sketch detects I2C devices, tries the two common
SSD1306 addresses (`0x3C` and `0x3D`), initializes a 128x64 display, and
cycles through text, shape, checkerboard, and progress-bar test screens.

## Wiring for the ESP32-C3 prototype

| OLED pin | ESP32-C3 pin |
|---|---|
| VCC | 3V3 |
| GND | GND |
| SDA | GPIO4 |
| SCL | GPIO5 |

Use the module's rated supply voltage. Most small SSD1306 I2C modules work at
3.3 V, but check the markings on the actual module before connecting it.

For an Arduino Uno/Nano, the sketch uses the board's default I2C pins
(A4/SDA and A5/SCL). For another ESP32 board, edit `I2C_SDA_PIN` and
`I2C_SCL_PIN` near the top of the sketch.

## Required library

Install these libraries through Arduino IDE Library Manager:

- Adafruit SSD1306
- Adafruit GFX Library

Open Serial Monitor at **115200 baud**. The sketch prints every responding I2C
address. A working OLED normally appears at `0x3C` or `0x3D`, then the display
cycles through four test screens every two seconds. Once initialized, it also
prints a `Heartbeat` line every two seconds. This makes it clear that the
sketch is still running even when the monitor was opened after startup.

For an ESP32-C3 using native USB, set **Tools > USB CDC On Boot > Enabled**,
select the current port after the board resets, open the monitor, and press the
board's **RST/EN** button once. If the port disappears and returns, select the
newly enumerated port.

If no device is found, check power, common ground, SDA/SCL orientation, pull-up
availability, and the selected SDA/SCL pins. The sketch also keeps scanning so
an OLED connected after boot can be detected.
