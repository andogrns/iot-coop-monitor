# MicroSD backup-storage test: classic ESP32 DevKit

Bench test for the six-pin "MicroSD Card Adapter" module (AMS1117-3.3
regulator and 74LVC125A buffer) on a classic, full-size ESP32 DevKit
(ESP32-WROOM-32). It does not test the active ESP32-C3 coop monitor. MicroSD
is not part of the active build. This sketch evaluates whether the adapter is
worth adding as backup storage.

## Wiring

```text
 MicroSD Card Adapter                 ESP32 DevKit (30/38-pin)
 ┌──────────────┐
 │          CS  ●──────────────────── GPIO4   (D4)
 │          SCK ●──────────────────── GPIO18  (D18)
 │          MOSI●──────────────────── GPIO23  (D23)
 │          MISO●──────────────────── GPIO19  (D19)
 │          VCC ●──────────────────── 5V / VIN   (NOT 3V3)
 │          GND ●──────────────────── GND
 └──────────────┘
```

| Adapter | ESP32 | Notes |
|---|---|---|
| CS | GPIO4 | Any free GPIO works; moved from GPIO5 while debugging. Avoid GPIO6–11. |
| SCK | GPIO18 | VSPI clock |
| MOSI | GPIO23 | VSPI MOSI |
| MISO | GPIO19 | VSPI MISO. Buffer outputs 3.3 V, safe for ESP32. |
| VCC | 5V / VIN | The onboard AMS1117-3.3 needs about 4.5–5 V input. At 3.3 V input the card gets only about 2.2 V and fails intermittently. |
| GND | GND | Common ground required |

- On USB power, the DevKit's `5V`/`VIN` pin carries USB 5 V.
- Do not use GPIO6–GPIO11. They connect to the module's internal flash.
- Keep jumpers short (under about 15 cm). The sketch falls back from 4 MHz to
  400 kHz. A fallback indicates a wiring or contact problem.
- This adapter's MISO buffer is always enabled, so it does not release the bus
  when CS is high. Give the adapter its own SPI bus rather than sharing it with
  another SPI device.

## Adapter B: 3.3 V six-pin adapter (3V3, CS, MOSI, CLK, MISO, GND)

The ESP32 GPIOs stay the same. Only the adapter's pin order and power pin
change. Wiring diagram: [wiring_adapter_b.html](wiring_adapter_b.html).

```text
 3.3 V MicroSD adapter                ESP32 DevKit (30/38-pin)
 ┌──────────────┐
 │          3V3 ●──────────────────── 3V3   (NOT 5V / VIN)
 │          CS  ●──────────────────── GPIO4   (D4)
 │          MOSI●──────────────────── GPIO23  (D23)
 │          CLK ●──────────────────── GPIO18  (D18)
 │          MISO●──────────────────── GPIO19  (D19)
 │          GND ●──────────────────── GND
 └──────────────┘
```

| Adapter B pin (header order) | ESP32 |
|---|---|
| 3V3 | **3V3** |
| CS | GPIO4 |
| MOSI | GPIO23 |
| CLK | GPIO18 |
| MISO | GPIO19 |
| GND | GND |

A pin labeled `3V3` means the card is powered directly at 3.3 V, so 5 V on
it can destroy the card. The DevKit's 3V3 regulator can supply a card's write
current. This adapter may have no MISO buffer or pull-up, so the MISO line
check can read `FLOATING` while it is wired correctly. For this adapter, the
mount result is the deciding test.

## Card preparation

Use a card of 32 GB or less, formatted **FAT32** (MBR) on a computer. The
sketch never formats the card. It only creates or removes files in `/sdtest`.
Use a spare card, or back up the card first.

## Run

Arduino IDE: **Tools > Board > esp32 > ESP32 Dev Module**, upload, then open
Serial Monitor at **115200 baud**. Set line ending to anything. Command
characters are read individually.

| Command | Action |
|---|---|
| `s` | Status, record counters, worst write time, card info |
| `t` | Repeat the 256 KiB write, read-back, and byte-compare test |
| `p` | Print the last 2 KiB of `/sdtest/backup_log.csv` |
| `c` | Delete the test log and start a new one |
| `u` / `m` | Unmount before safe card removal / mount again |
| `w` | Wiring scan (only when not mounted) |
| `h` | Help |

## What each stage proves

| Output | Meaning |
|---|---|
| `Mount: PASS at 4000 kHz` | Power, wiring, card, and FAT volume work at the old logger's speed |
| `Mount: PASS at 400 kHz` | Card works only slowly; check wire length and contacts |
| `Mount: FAIL` | No card, non-FAT format such as exFAT, wrong power (VCC on 3V3), or wiring fault |
| `Line check MISO: held` | Printed after the first failure. MISO is wired. This does **not** prove the adapter has power, because the ESP32 signal pins can back-feed its rail through pull-ups. Measure VCC/3V3 to GND on the adapter. |
| `Line check MISO: FLOATING` | MISO wire open, adapter unpowered, or no pull-up on an unbuffered adapter |
| `Line check CS/SCK/MOSI: held HIGH` | That wire reaches a pull-up on the adapter |
| `Wiring scan` | Sends CMD0 using each assignment of SCK/MOSI/MISO to GPIO18/19/23. An answer on a non-expected row means those wires are swapped. No answer on any row points to CS, power, GND or card seating. Also available with `w`. |
| `Write/verify test: PASS` | 256 KiB was written, closed, reread, and matched byte-for-byte. Reports KiB/s. |
| `LOG ... OK` every 5 s | Each CSV record was appended and closed. File size grew by exactly the record length. |
| `max_write` in `s` | Worst append latency. Watch for occasional spikes of hundreds of ms; those show the card's internal housekeeping. |
| `Backup log: ... resuming at boot N` | After reset or power loss, the previous records persisted and the sequence continues |
| `last record is INCOMPLETE` | Power was cut mid-write. Earlier records survived and the fragment was terminated. |

Suggested checks:

1. Let it log for a few minutes and verify `failed=0` in `s`.
2. Unplug USB mid-run several times, then confirm each boot resumes the
   sequence. Use `p` to look for gaps beyond the record lost at power-cut.
3. Pull the card without `u`. Confirm `FAIL`, then reinsert it and confirm the
   automatic remount.
4. Read `/sdtest/backup_log.csv` on a computer.

A pass shows that this adapter, card, and wiring work on a classic ESP32. It
does not validate the ESP32-C3 pin mapping, shared power with the MQ-135
heater, or long-term field endurance.
