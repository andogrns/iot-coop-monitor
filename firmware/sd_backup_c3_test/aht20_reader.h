#pragma once

#include <Arduino.h>
#include <Wire.h>
#include <math.h>
#include <string.h>

// AHT20 (not AHT10): Aosong's BE initialization, >=80 ms conversion,
// bounded busy polling, and seven-byte CRC-protected frames.
class Aht20Reader {
 public:
  bool begin(TwoWire &wire, uint8_t address = 0x38) {
    wire_ = &wire;
    address_ = address;
    if (beginOnce()) return true;
    if (strcmp(error_, "busy_timeout") == 0) return false;
    delay(10);
    return beginOnce();
  }

  bool read(float &temperature, float &humidity) {
    if (readOnce(temperature, humidity)) return true;
    // Retry a complete conversion, never a partial or stale data frame.
    // A persistent busy fault retains the original bounded polling limit.
    if (strcmp(error_, "busy_timeout") != 0) {
      delay(10);
      if (readOnce(temperature, humidity)) {
        ++recoveredReads_;
        return true;
      }
    }
    ++failedReads_;
    return false;
  }

  const char *error() const { return error_; }
  uint32_t recoveredReads() const { return recoveredReads_; }
  uint32_t failedReads() const { return failedReads_; }

  static uint8_t crc8(const uint8_t *bytes, size_t length) {
    uint8_t crc = 0xFF;
    for (size_t i = 0; i < length; ++i) {
      crc ^= bytes[i];
      for (uint8_t bit = 0; bit < 8; ++bit)
        crc = (crc & 0x80) ? (crc << 1) ^ 0x31 : crc << 1;
    }
    return crc;
  }

 private:
  TwoWire *wire_ = nullptr;
  uint8_t address_ = 0x38;
  const char *error_ = "not_started";
  uint32_t recoveredReads_ = 0;
  uint32_t failedReads_ = 0;

  bool beginOnce() {
    delay(40);
    uint8_t status;
    if (!waitReady(status)) return false;
    if (!(status & 0x08)) {
      const uint8_t init[] = {0xBE, 0x08, 0x00};
      if (!write(init, sizeof(init))) return false;
      delay(10);
      if (!waitReady(status)) return false;
    }
    if (!(status & 0x08)) return fail("not_initialized");
    error_ = "none";
    return true;
  }

  bool readOnce(float &temperature, float &humidity) {
    temperature = humidity = NAN;
    const uint8_t trigger[] = {0xAC, 0x33, 0x00};
    if (!write(trigger, sizeof(trigger))) return false;
    // Busy may not be asserted immediately after the command. Polling first
    // can return the previous frame or zeros instead of a fresh conversion.
    delay(80);
    uint8_t status;
    if (!waitReady(status)) return false;
    uint8_t frame[7];
    if (wire_->requestFrom(address_, uint8_t(sizeof(frame))) != sizeof(frame)) {
      drain();
      return fail("short_frame");
    }
    for (uint8_t &byte : frame) byte = wire_->read();
    if ((frame[0] & 0x80) || !(frame[0] & 0x08)) return fail("invalid_status");
    if (crc8(frame, 6) != frame[6]) return fail("crc_mismatch");
    const uint32_t h = (uint32_t(frame[1]) << 12) | (uint32_t(frame[2]) << 4) | (frame[3] >> 4);
    const uint32_t t = (uint32_t(frame[3] & 0x0F) << 16) | (uint32_t(frame[4]) << 8) | frame[5];
    temperature = t * 200.0f / 1048576.0f - 50.0f;
    humidity = h * 100.0f / 1048576.0f;
    error_ = "none";
    return true;
  }

  bool fail(const char *message) { error_ = message; return false; }
  void drain() { while (wire_->available()) wire_->read(); }
  bool write(const uint8_t *data, size_t length) {
    if (!wire_) return fail("not_started");
    wire_->beginTransmission(address_);
    wire_->write(data, length);
    if (wire_->endTransmission() != 0) return fail("write_failed");
    return true;
  }
  bool readStatus(uint8_t &status) {
    if (wire_->requestFrom(address_, uint8_t(1)) != 1) {
      drain();
      return fail("status_read_failed");
    }
    status = wire_->read();
    return true;
  }
  bool waitReady(uint8_t &status) {
    const uint32_t start = millis();
    do {
      if (!readStatus(status)) return false;
      if (!(status & 0x80)) return true;
      delay(10);
    } while (millis() - start < 250);
    return fail("busy_timeout");
  }
};
