# MQ-135 standalone test — Arduino Uno

For a classic 5 V ATmega328P Uno (including older Uno revisions) and an MQ-135
module with VCC, GND, AO and DO pins. Not a bare six-pin sensor.
No external libraries. Averages 32 samples and prints CSV every 2 seconds.

## Pin diagram

```text
MQ-135 module              Arduino Uno
VCC ---------------------- 5V
GND ---------------------- GND
AO  ---------------------- A0
DO  (leave disconnected)
```

AO connects directly to A0 on this 5 V Uno; no ESP32 voltage divider is needed.
Power off before wiring. Use the printed pin labels. Power the Uno by USB with
enough capacity for the board and sensor heater. Do not power the heater from
3.3V or a GPIO. AO must remain between GND and the Uno supply voltage.
If using a separate regulated 5 V module supply, share GND and avoid powering
the sensor while the Uno is off. Do not connect an external supply to USB 5V.

## Upload and view

1. Open mq135_test.ino in Arduino IDE.
2. Select Arduino Uno under Arduino AVR Boards and choose the actual USB port.
3. Upload, then open Serial Monitor at 115200 baud.

This replaces the sketch currently on the Uno. It does not write EEPROM.

## Save a CSV on your PC

Close Serial Monitor, then run from the repository root in PowerShell:

    [System.IO.Ports.SerialPort]::GetPortNames()
    powershell.exe -NoProfile -ExecutionPolicy Bypass -File "./firmware/mq135_test/log_serial.ps1" -Port COM7 -OutputPath "./mq135-test.csv"

Replace COM7 with the actual port. Press Ctrl+C to stop. Existing files are not
overwritten. Capture is manually started only; nothing is scheduled. Opening
Serial can reset the Uno. No readings are saved while capture is closed.
CSV includes PC timestamp with timezone, sample number, uptime, raw ADC,
estimated AO millivolts and status. Uptime wraps after about 49.7 days.

## Interpretation

- raw_adc: averaged 10-bit reading (0–1023).
- estimated_ao_mv: raw * ADC_REFERENCE_MV / 1023. Default reference is nominal
  5000 mV; for a better estimate, measure the Uno 5V rail and edit that constant.
  This is an estimate, not a calibrated millivolt measurement.
- WARMUP: first 10 minutes. Elapsed time does not prove sensor stability.
- READING: warm-up timer elapsed, not a gas safety verdict.
- ADC_HIGH: raw >=1020, near saturation.
- LOW_CHECK_WIRING: raw <=2; check power/wiring, not a definitive fault diagnosis.
  High/low flags take precedence over warm-up.

Follow the module manufacturer's initial conditioning instructions. Record a
stable ambient baseline and observe changes under normal test conditions.
Temperature, humidity and multiple gases affect the response. Do not test with
flame, concentrated gas or solvent spraying. This measures relative gas response,
not calibrated ammonia ppm or odor concentration.

## Verification

Compiled locally for arduino:avr:uno. Not uploaded or physically tested.
