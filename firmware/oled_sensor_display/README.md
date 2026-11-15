# OLED sensor display

This Arduino IDE sketch is for the current ESP32-C3 SuperMini prototype. It
displays the AHT20, BMP280, and MQ-135 readings on a 128x64 I2C SSD1306 OLED.
The OLED, AHT20, and BMP280 share the same I2C bus.

## Wiring

| Module pin | ESP32-C3 SuperMini |
|---|---|
| OLED VCC | 3V3 |
| OLED GND | GND |
| OLED SDA | GPIO4 |
| OLED SCL | GPIO5 |
| AHT20/BMP280 VDD | 3V3 |
| AHT20/BMP280 GND | GND |
| AHT20/BMP280 SDA | GPIO4 |
| AHT20/BMP280 SCL | GPIO5 |
| MQ-135 AO | GPIO3 through equal 10 kOhm/10 kOhm divider |

Install these libraries in Arduino IDE Library Manager:

- Adafruit SSD1306
- Adafruit GFX Library
- Adafruit AHTX0
- Adafruit BMP280 Library
- Adafruit Unified Sensor

The expected I2C addresses are OLED `0x3C`, AHT20 `0x38`, and BMP280 `0x76` or
`0x77`. If the OLED remains blank, change `OLED_ADDRESS` to `0x3D`.

The display refreshes every second. Serial Monitor output is available at
115200 baud for more detailed values. `ERR` on the OLED means that sensor was
not detected or did not return a valid reading.

The MQ-135 value is shown as ADC millivolts and is only a relative gas-response
indicator. It is not a calibrated ammonia concentration.
