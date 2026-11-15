# Complete OLED + AHT20/BMP280 + MQ-135 test

This sketch tests the complete prototype sensor set on an ESP32-C3:

- 128x64 SSD1306 I2C OLED;
- the combined four-pin AHT20+BMP280 I2C module; and
- a four-pin MQ-135 analog gas-response module (`AO`, `DO`, `GND`, `VCC`).

The OLED and combined sensor module share the I2C bus. The MQ-135 uses the
ESP32-C3 ADC1 input on GPIO3 through a voltage divider. Readings are shown on
the OLED and printed to Serial Monitor every two seconds.

## Pin diagram

```text
ESP32-C3          SSD1306 OLED       Combined AHT20+BMP280       MQ-135 module
┌─────────┐       ┌─────────┐        ┌──────────────────┐       ┌──────────┐
│ 3V3 ────┼───────┤ VCC     │        │ VDD              │       │          │
│ GND ────┼───────┤ GND     │────────┤ GND              │───────┤ GND      │
│ GPIO4 ──┼───────┤ SDA     │────────┤ SDA              │       │          │
│ GPIO5 ──┼───────┤ SCL     │────────┤ SCL              │       │          │
│ GPIO3 ◄─┼─ through divider ──────────────────────────────────┤ AO       │
│ 5V/VBUS ┼─────────────────────────────────────────────────────┤ VCC      │
│ NC      ┼─────────────────────────────────────────────────────┤ DO       │
└─────────┘       └─────────┘        └──────────────────┘       └──────────┘
```

### Direct connections

| ESP32-C3 pin | OLED | Combined AHT20+BMP280 | MQ-135 |
|---|---|---|---|
| `3V3` | VCC | VDD | — |
| `GND` | GND | GND | GND |
| `GPIO4` | SDA | SDA | — |
| `GPIO5` | SCL | SCL | — |
| `GPIO3` | — | — | AO through divider |
| `5V/VBUS` | — | — | VCC |
| Not connected | — | — | DO |

### MQ-135 voltage divider

Do not connect MQ-135 `AO` directly to GPIO3. Wire it as follows:

```text
MQ-135 AO ─── 10 kΩ resistor ───┬─── ESP32-C3 GPIO3
                                │
                              10 kΩ
                                │
                               GND
```

The two equal resistors divide the MQ-135 analog output by approximately two.
The sketch reports the ADC-side voltage and estimates the original module-side
voltage by multiplying by 2.0. Measure the actual divider voltage before
leaving the circuit connected, especially if the MQ module is powered from 5 V.

The MQ-135 heater/module uses `5V/VBUS`; the OLED and combined AHT20+BMP280
module use `3V3`. All devices must share ESP32-C3 ground.

The module's `DO` pin is a digital comparator output controlled by its onboard
potentiometer. This sketch does not use it; leave `DO` disconnected. The
analog `AO` pin is the signal being measured.

## Expected I2C addresses

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

The MQ-135 result is raw gas-response data, not calibrated ammonia ppm. The
sensor requires warm-up and reference calibration before its response can be
used as an ammonia-related trend.
