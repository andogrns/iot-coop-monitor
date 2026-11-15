#include <Arduino.h>

// Classic 5 V Arduino Uno (ATmega328P): MQ module AO directly to A0.
const uint8_t MQ_PIN = A0;
const float ADC_REFERENCE_MV = 5000.0f; // Replace with measured Uno 5V rail.
const unsigned long INTERVAL_MS = 2000;
const unsigned long WARMUP_MS = 600000;
unsigned long previousMs = 0;
unsigned long sample = 0;
bool warmedUp = false;

void setup() {
  Serial.begin(115200);
  analogReference(DEFAULT);
  delay(1500);
  Serial.println(F("sample,uptime_ms,raw_adc,estimated_ao_mv,status"));
}

void loop() {
  unsigned long now = millis();
  if (now >= WARMUP_MS) warmedUp = true;
  if ((unsigned long)(now - previousMs) < INTERVAL_MS) return;
  previousMs = now;
  unsigned long total = 0;
  for (uint8_t i = 0; i < 32; ++i) {
    total += analogRead(MQ_PIN);
    delay(2);
  }
  float raw = total / 32.0f;
  float mv = raw * ADC_REFERENCE_MV / 1023.0f;
  Serial.print(++sample);
  Serial.print(',');
  Serial.print(now);
  Serial.print(',');
  Serial.print(raw, 1);
  Serial.print(',');
  Serial.print(mv, 1);
  Serial.print(',');
  if (raw >= 1020) Serial.println(F("ADC_HIGH"));
  else if (raw <= 2) Serial.println(F("LOW_CHECK_WIRING"));
  else if (!warmedUp) Serial.println(F("WARMUP"));
  else Serial.println(F("READING"));
}
