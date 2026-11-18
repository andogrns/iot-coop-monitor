# AHT20 + BMP280 + OLED test

This sketch tests a combined AHT20+BMP280 sensor module and a 128x64 SSD1306
I2C OLED together on the same ESP32-C3 I2C bus. It scans the bus, initializes
both sensors on the combined module, shows readings on the OLED, and prints
readings to Serial Monitor every two seconds.

## Wiring

The pictured AHT20+BMP280 board is one combined module with four pins. Connect
it and the OLED in parallel to the same SDA, SCL, 3V3, and GND lines:

```text
ESP32-C3             SSD1306 OLED       Combined AHT20+BMP280
┌─────────┐          ┌─────────┐        ┌──────────────────┐
│ 3V3 ────┼──────────┤ VCC     │        │ VDD              │
│         │          └─────────┘        │                  │
│ GND ────┼──────────┤ GND     │        │ GND              │
│         │          └─────────┘        │                  │
│ GPIO4 ──┼──────────┤ SDA     │────────┤ SDA              │
│ GPIO5 ──┼──────────┤ SCL     │────────┤ SCL              │
└─────────┘          └─────────┘        └──────────────────┘
```

| ESP32-C3 pin | OLED pin | Combined sensor pin |
|---|---|---|
| 3V3 | VCC | VDD |
| GND | GND | GND |
| GPIO4 | SDA | SDA |
| GPIO5 | SCL | SCL |

Do not connect the OLED reset pin; the sketch uses `OLED_RESET_PIN = -1`. The
combined sensor board has no separate BMP280 CS/SDO pins exposed, so no extra
address wiring is needed.

Expected addresses are:

- OLED: `0x3C` or `0x3D`
- AHT20: `0x38`
- BMP280: `0x76` or `0x77`

## Required libraries

Install through Arduino IDE Library Manager:

- Adafruit SSD1306
- Adafruit GFX Library
- Adafruit AHTX0
- Adafruit BMP280 Library
- Adafruit Unified Sensor

Select the ESP32-C3 board, keep **USB CDC On Boot** enabled, and open Serial
Monitor at **115200 baud**. Press **RST/EN** after opening the monitor if the
startup messages were missed.

The OLED shows AHT20 temperature/humidity, BMP280 temperature/pressure, and a
device status line. `ERR` means that a detected library object did not return a
valid reading. The I2C scan and Serial messages identify missing or miswired
devices.
