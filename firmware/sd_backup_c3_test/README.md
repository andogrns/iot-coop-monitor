# MicroSD backup test: ESP32-C3 SuperMini (coop pins)

Proposal and bench test only. While this test is installed it **replaces the coop
firmware** on the C3, so there are no cloud uploads during the test. Afterwards,
reinstall the coop firmware with `../coop_monitor/upload_wifi_cloud.ps1`.

The sketch is built with the coop monitor's own `partitions.csv` (the partition
table binary is identical). It never opens NVS, so calibration and Wi-Fi settings
are untouched, and it never touches the flash-queue partition. Upload with
erase-all off, after a full flash backup.

Wiring: [wiring_c3_proposal.html](../sd_backup_esp32_test/wiring_c3_proposal.html).

- MQ-135 on GPIO3, through the divider. Same averaging and attenuation as the coop
  firmware.
- AHT20/BMP280 on GPIO4/5 at 100 kHz.
- SD card: CS 10, SCK 6, MOSI 7, MISO 1.

## Write strategy (card longevity)

| Choice | Why |
|---|---|
| Readings are buffered in RAM (16 KiB) and flushed every 15 min, or earlier at 12 KiB | About 96 file updates per day instead of 17,280 at one reading every 5 s. The FAT and directory entry are updated once per flush. |
| Only whole 512-byte sectors are written; the remainder stays in RAM | The file stays sector-aligned, so no card sector is ever rewritten for log data |
| A new file `/coop/bNNNNN.csv` starts on each boot and each remount | After a power cut, nothing is rewritten in the previous file |
| Every flush is read back and byte-compared | Proves each write without wearing the card (reads cause no wear) |
| `flush_ms_before` column | Marks the sample taken right after a flush, so MQ mV during SD activity can be compared with quiet periods |

Trade-off: a power cut loses the readings still in RAM, at most about 15 minutes
plus less than 512 bytes. Everything flushed earlier is on the card. A file that
ended at a power cut can stop mid-line; drop that last partial line when reading
it.

## Build

```powershell
& "$env:LOCALAPPDATA\Programs\Arduino IDE\resources\app\lib\backend\resources\arduino-cli.exe" compile `
  --fqbn 'esp32:esp32:nologo_esp32c3_super_mini:CDCOnBoot=cdc,PartitionScheme=no_ota,EraseFlash=none' `
  --output-dir outputs/sd_c3_test/build firmware/sd_backup_c3_test
```

## Serial commands (115200 baud)

| Command | Action |
|---|---|
| `s` | Status: file, bytes on card, RAM buffer, flush and verify counters, sensors |
| `f` | Flush whole sectors now (for a quick test) |
| `p` | Print the last 1.5 KiB of the current file, read from the card |
| `l` | List log files |
| `u` | Write everything, including the partial sector, then unmount (safe removal) |
| `m` | Mount again, starting a new file |
