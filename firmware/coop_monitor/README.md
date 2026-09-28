# Integrated MQ-135 + AHT20/BMP280 + OLED + MicroSD monitor

`coop_monitor.ino` combines live monitoring, MicroSD CSV logging, and
command-triggered clean-air calibration for the ESP32-C3 SuperMini. The sensor
set is the MQ-135 and a combined AHT20/BMP280 module; the SSD1306 OLED shows
current values and the main status. The MQ reading is a relative gas response,
not ammonia ppm. Serial Monitor remains available for live readings and
calibration commands; no connected computer is needed to save measurements.

## Wiring

| Module pin | ESP32-C3 connection |
|---|---|
| MQ-135 VCC | 5V / VBUS |
| MQ-135 GND | GND |
| MQ-135 AO | 10 kOhm resistor to GPIO3; second 10 kOhm resistor from GPIO3 to GND |
| MQ-135 DO | Not connected |
| AHT20/BMP280 combo VCC | 3V3 |
| AHT20/BMP280 combo GND | GND |
| AHT20/BMP280 combo SDA | GPIO4 |
| AHT20/BMP280 combo SCL | GPIO5 |
| SSD1306 OLED VCC | 3V3 |
| SSD1306 OLED GND | GND |
| SSD1306 OLED SDA | GPIO4 |
| SSD1306 OLED SCL | GPIO5 |
| MicroSD adapter VCC | 5V / VBUS, after confirming this adapter accepts 5 V |
| MicroSD adapter GND | GND |
| MicroSD adapter CS | GPIO10 |
| MicroSD adapter SCK | GPIO6 |
| MicroSD adapter MOSI | GPIO7 |
| MicroSD adapter MISO | GPIO1, after confirming its output does not exceed 3.3 V |

```text
ESP32-C3 SuperMini                 Modules
5V / VBUS ──────────────────────── MQ-135 VCC; MicroSD VCC (verify 5 V rating)
3V3 ────────────────────────────── AHT20/BMP280 VCC; SSD1306 OLED VCC
GND ────────────────────────────── MQ-135, AHT20/BMP280, OLED, MicroSD GND
GPIO4 (SDA) ────────────────────── AHT20/BMP280 SDA; OLED SDA
GPIO5 (SCL) ────────────────────── AHT20/BMP280 SCL; OLED SCL
GPIO10 ─────────────────────────── MicroSD CS
GPIO6 ──────────────────────────── MicroSD SCK
GPIO7 ──────────────────────────── MicroSD MOSI
GPIO1 ◄─────────────────────────── MicroSD MISO (verify <= 3.3 V)

MQ-135 AO ── 10 kOhm ──┬────────── GPIO3
                        │
                      10 kOhm
                        │
                       GND
MQ-135 DO ──────────────────────── Not connected
```

The pictured six-pin SPI MicroSD adapter has, from top to bottom with its card
slot facing you and the header on the right: `CS`, `SCK`, `MOSI`, `MISO`, `VCC`,
`GND`. Its visible components suggest a regulator and logic buffer, but their
exact ratings cannot be read from the photo. Confirm the actual adapter accepts
5 V at `VCC` and measure `MISO` at no more than 3.3 V before connecting it to
GPIO1. The MicroSD connections avoid the ESP32-C3 boot strapping pins GPIO2,
GPIO8, and GPIO9. The integrated sketch initializes SPI on these pins and
writes its CSV readings to the card.

The combo module and OLED share the 3.3 V I2C bus on GPIO4/GPIO5. The sketch
looks for AHT20 at `0x38`, BMP280 at `0x76` or `0x77`, and OLED at `0x3C` or
`0x3D`. Confirm the actual modules support 3.3 V power and I2C levels. Measure
the divider output before connecting GPIO3. All modules and the ESP32-C3 need
a common ground. Keep the combo sensor away from the MQ heater.

## Arduino setup and operation

Install **ESP32 by Espressif Systems**, **Adafruit AHTX0**, **Adafruit BMP280**,
**Adafruit SSD1306**, and **Adafruit GFX** in Arduino IDE, accepting prompted
dependencies. The SPI and SD libraries come with the ESP32 board package.
Select the ESP32-C3 board, enable **Tools > USB CDC On Boot**,
and upload `coop_monitor.ino`. The sketch sends labeled reading blocks at 115200
baud every two seconds, with units beside each value and separate AHT20 and
BMP280 lines. It checks the saved calibration in
ESP32 Preferences after boot.

The 128x64 OLED refreshes with each two-second sample. It shows MQ ADC mV,
ratio to the stored clean-air baseline, threshold, AHT20 temperature and
humidity, BMP280 temperature and pressure, and the highest-priority status.
`--` means a value is unavailable. The complete set of status flags remains in
the Serial block and CSV row, using readable status labels. An OLED failure
does not stop Serial readings or logging.

A new MQ-135 needs more than 48 hours of continuous initial conditioning
before its first clean-air calibration. Put the conditioned sensor in stable,
well-ventilated reference air away from the coop and strong gas sources. Send
`CAL START` with **Newline** selected in Arduino Serial Monitor. The sketch
stabilizes for ten minutes, then collects readings for five minutes. A valid
calibration needs at least 60 usable MQ/AHT20 samples. BMP280 pressure is
logged but is not used in the MQ threshold formula. `CAL CANCEL` stops
collection without replacing the previous calibration; `CAL SHOW` prints the
saved values. If calibration succeeds, the ESP32 saves the result in Preferences.

The initial gas warning threshold is the larger of **15% above the clean-air
ADC baseline** and **baseline plus three standard deviations**. The sketch
requires three consecutive two-second readings over this threshold. Warnings
are disabled during boot warm-up, calibration, missing calibration, or an
ADC-high reading. `AHT_ERROR`, `BMP_ERROR`, and `OLED_ERROR` identify missing
or invalid peripheral readings; an existing MQ calibration can still drive a
gas warning if a peripheral fails. The threshold assumes the module voltage
rises with the response of interest; confirm this with the actual module
before using the warning in a coop.

## MicroSD logging

Insert a FAT32-formatted card and power the ESP32-C3 to start saving readings
on the card.
The first available `/COOP0001.CSV` through `/COOP9999.CSV` filename is chosen
for each boot, so uptime resets do not mix in one file. The first sample is
saved immediately, then one sample every 30 seconds and whenever the status
changes. The two-second sampling and gas-warning checks continue independently
of file writes. Each row is closed after writing to limit data loss on power
interruption. Power off the board before removing the card to read it on a
computer.

If the card is missing or cannot be written, Serial reports the error and the
OLED shows `SD ERROR` unless a gas or ADC warning has higher priority. A card
removed during operation may not be detected until the next scheduled write. The
firmware retries mounting the card every ten seconds; monitoring and Serial
output continue. After reinsertion during the same boot, logging resumes in
the same file. The existing clean-air calibration is kept in ESP32 Preferences;
`CAL SHOW` or `CAL EXPORT` can still print it over Serial for manual backup.
The former Windows capture scripts are retained as legacy tools but are not
needed for MicroSD logging.

### List and download files through USB

With the ESP32-C3 connected to a computer, open Serial Monitor at 115200 baud,
select **Newline**, and send `SD LIST`. The monitor prints each file path and
size, including files in subdirectories (up to eight directory levels). This
does not remove or change any files. `HELP` shows the available commands.

To save a file on Windows, close Serial Monitor and any manually started
computer logger, then run `start_sd_transfer.cmd` in this folder. The helper
finds a non-Bluetooth COM port (or asks you to choose one), lists the card's
files, and prompts for a file number. It saves the selected file under
`outputs/sd_downloads/`, adding a number to the name if a copy already exists.
It checks the byte count and CRC32 before keeping the download. Choose `R` to
refresh the list or `Q` to quit. For a specific port or destination, run:

```powershell
pwsh -NoProfile -File .\firmware\coop_monitor\sd_transfer.ps1 -Port COM7 -OutputDirectory C:\Users\Ando\Downloads
```

Only one application can own the COM port. Close the transfer helper before
reopening Serial Monitor or starting manual computer capture. The helper runs
only when launched and exits when you quit. Monitoring, OLED updates, and live
Serial readings continue during a download; writes to the MicroSD card pause
until it finishes. This means a long download can omit some scheduled CSV rows.
The helper does not delete or modify the MicroSD file. If the connection fails
or the verification does not match, it removes its partial computer copy.

The firmware uses `SD LISTPROTO` for the helper and `SD GET /PATH/FILE.CSV` to
send hex-encoded chunks with sequence numbers and a final CRC32. These are
Serial commands, so the ESP32-C3 does not appear as a USB storage drive.

### Reading format

Serial Monitor displays the following six-line block with a blank line between
samples (illustrative values, not a recorded measurement):

```text
--- Sample 900 | Uptime 00:30:00 ---
MQ-135  : ADC 1100 mV | Output 2.200 V | Raw 1800
Baseline: 1.1000x (+10.0%) | Warning threshold 1150 mV
AHT20   : Temperature 29.45 C | Humidity 72.30 %RH
BMP280  : Temperature 30.12 C | Pressure 1008.65 hPa
Status  : OK
```

The baseline percentage is the change in ADC voltage relative to the stored
clean-air baseline, not a gas concentration. The displayed threshold is rounded
to whole mV; warning comparisons still use the stored, unrounded value. Uptime
uses hours:minutes:seconds, with hours continuing past 24. Without calibration,
the baseline line reads `Baseline: NA | Warning threshold NA mV`.

The same sample becomes this MicroSD CSV row:

```csv
Record reason,Sample number,Uptime (s),MQ raw ADC,MQ ADC (mV),MQ output (V),MQ baseline ratio,AHT temperature (C),Humidity (%RH),BMP temperature (C),Pressure (hPa),Status
Periodic,900,1800,1800,1100,2.200,1.1000,29.45,72.30,30.12,1008.65,OK
```

CSV units live in the headings so available measurements remain numeric.
Unavailable measurements use `NA`. The ESP32-C3 has no real-time clock in this
build, so the file uses uptime since boot rather than an invented date/time.
`Record reason` is `Periodic` or `Status change`. Saved readings are individual
samples, not 30-second averages. A status-change save restarts the 30-second
interval.

| Internal flag | Serial and CSV label |
|---|---|
| `OK` | OK |
| `WARMUP` | Warming up |
| `CAL_MISSING` | Calibration missing |
| `CAL_STABILIZING` | Calibration stabilizing |
| `CAL_COLLECTING` | Calibration collecting |
| `AHT_ERROR` | AHT sensor error |
| `BMP_ERROR` | BMP sensor error |
| `OLED_ERROR` | OLED error |
| `MQ_ADC_HIGH` | MQ ADC high |
| `GAS_WARNING` | Gas warning |

Multiple labels are separated by ` | `. Calibration commands and `@CAL`
responses remain on Serial. Recalibrate when replacing the MQ sensor or
changing its analog circuit.

## Offline verification

Run `pwsh -NoProfile -File .\firmware\coop_monitor\sd_transfer.ps1 -SelfTest`
to check file-list parsing, a complete download, CRC32 verification, and
partial-file cleanup after a corrupted transfer. This uses a simulated serial
transcript; the physical USB and MicroSD path still needs a connected board.

Run `pwsh -NoProfile -File .\firmware\coop_monitor\test_reading_format.ps1`
from the workspace root. This checks numeric CSV fields, `NA`, readable status
labels, and the Serial format. With `g++` available, it compiles the actual
Serial and MicroSD formatting functions with a host adapter. This does not
compile the ESP32 SD library or test card mounting, writes, or physical wiring.
The sketch compiled for `Nologo ESP32C3 Super Mini` with the installed ESP32
core 3.3.11. It has not been uploaded or run on the physical board. After
uploading, read the card on a computer to confirm the file and sample rows
before relying on it.
