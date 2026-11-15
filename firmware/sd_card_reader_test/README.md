# MicroSD reader test: classic Arduino Uno or ESP32-C3

Open `sd_card_reader_test.ino` in Arduino IDE. The sketch sends a raw SD card
command (`CMD0`) to check the SPI path, then asks the board's SD library to
mount the card. After a successful mount, it lists files and folders from the
card's root, descending into subfolders and showing each file's size in bytes.
It does not create, change, or delete card files. The six-pin
SPI adapter itself has no address or identification output, so the test can
only detect a card responding through it.

## Arduino Uno R1/R3 wiring

For an **Uno R1 with ATmega328P**, select **Arduino Uno** in Arduino IDE. The
same wiring applies to the classic Uno R3. Their hardware SPI pins are fixed:

```text
Six-pin SPI MicroSD adapter          Arduino Uno R1/R3
CS   -------------------------------- D10 (SS / chip select)
SCK  -------------------------------- D13 (SCK)
MOSI -------------------------------- D11 (MOSI)
MISO -------------------------------- D12 (MISO)
GND  -------------------------------- GND
VCC  -------------------------------- 5V ONLY if this adapter is rated for
                                     5 V power AND 5 V logic inputs
```

The Uno drives CS, SCK, and MOSI at **5 V**. A card socket or 3.3 V-only
breakout cannot be connected directly to those pins. If the adapter is 3.3 V
only, use a suitable external 3.3 V supply and shift Uno-to-card CS, SCK,
and MOSI down to 3.3 V. Do not assume that a regulator on the adapter also
shifts the logic signals. Check the exact adapter's specifications or circuit
before wiring power and signal pins. Do not rely on the Uno's onboard 3.3 V pin
as a card supply without verifying its available current and the card's demand.

With power off, insert the card and check each connection. Upload the sketch,
then open Serial Monitor at **115200 baud**. The Uno runs the test once at
startup; press **Reset** to test again after changing the card. If `SD.begin`
fails at its default speed, the sketch retries at **1 MHz**, then **250 kHz**.
It clears the library's read cache before each attempt so the card's sectors
are actually reread at the selected speed. If all attempts fail, it retries
its three read-only stages separately: card initialization, FAT volume
detection at 250 kHz, and opening the root directory. A slower retry passing
suggests a signal or timing problem. A stage passing on retry after an earlier
failure suggests an intermittent connection. The Uno sketch
uses `SPI.h` and the official **SD** library. If Arduino IDE reports
`SD.h: No such file or directory`, install **SD by Arduino** in Library Manager.
The sketch is not intended for an Uno R4.

## ESP32-C3 SuperMini wiring

| MicroSD adapter pin | ESP32-C3 pin |
|---|---|
| CS | GPIO10 |
| SCK | GPIO6 |
| MOSI | GPIO7 |
| MISO | GPIO1 |
| GND | GND |
| VCC | 5V/VBUS only if adapter is rated for 5 V input |

Confirm the adapter's MISO signal is at most 3.3 V before connecting GPIO1.
Select the ESP32-C3 board, enable **Tools > USB CDC On Boot**, upload, and open
Serial Monitor at **115200 baud**. The ESP32-C3 repeats the test every five
seconds and reports card type and capacity after a successful mount. It lists
the card contents once after detection; press **Reset** to list again. It uses
the same 4 MHz mount speed as `coop_monitor.ino`.

## Interpreting results

| SPI response | SD initialization and mount | Next check |
|---|---|---|
| FAIL, usually `CMD0 response: 0xFF` | FAIL | Check card seating, adapter supply, common ground, CS/SCK/MOSI/MISO wiring, and the card in a computer reader. Swap a known-good card or adapter to isolate the part. |
| PASS, `CMD0 response: 0x01` | FAIL | The card answered one command at the probe speed. On the Uno, read the stage diagnostics to distinguish card initialization from FAT volume or root-directory failure. Check the card in a computer, then try shorter wiring. Back up card data before considering a format. |
| PASS | PASS | The tested card, adapter, and wiring work together on this board. The file and folder listing follows. |

A failed SPI probe does not prove which individual part failed. A successful
probe does not by itself prove that the filesystem can be read.

If the Uno's FAT volume check fails, the sketch prints the card error code and
reads sector 0 twice at 250 kHz. It streams the complete 512-byte sector
through a 32-byte buffer to conserve RAM, compares read checksums, and reports
the `55 AA` sector signature. For an MBR layout it prints all four partition
entries and reads the boot sectors of FAT partitions with valid bounds.

| Additional Uno diagnostic | Interpretation |
|---|---|
| Sector read FAIL / card error `0x3`, `0xD`, or `0xF` | The block-read command or data transfer failed. Check adapter power, signal levels, contacts, wiring, and a second card. |
| Read checksums differ | The received bytes changed between reads of the same sector. Investigate the SPI connection and power. |
| Matching checksums but INVALID signature | The received sector lacks the expected MBR/FAT signature. Repeatable data alone does not establish that it is correct; compare the disk layout in a computer reader. |
| Protective partition type `0xEE` | The card uses GPT. The standard Uno SD library expects MBR or an unpartitioned FAT volume. |
| FAT is in partition 2, 3, or 4 | Standard Uno `SD.begin()` only tries partition 1, then an unpartitioned FAT volume. |
| Valid, repeatable boot-sector reads but FAT still fails | Investigate the partition and FAT boot fields or library compatibility before changing the card's format. |

Sector samples are diagnostic reads only; matching checksums do not validate
every sector or prove that all card data is intact.

The directory listing is indented to show nesting, labels folders as `[DIR]`
and files as `[FILE]`, and ends with file and folder counts. A card with an
unusually deep folder tree may exceed the Uno's limited RAM while recursing;
for normal card layouts the listing is read-only.
