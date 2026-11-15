#pragma once

#include <Arduino.h>
#include <Wire.h>
#include <math.h>
#include <string.h>

// Checked BMP280 transport and compensation from Bosch's BMP280 data sheet,
// sections 3.11, 5.2.2 and 8.1. A STOP between pointer write and read is supported.
// Factory trim is read twice; failed/short transfers never yield measurements.
class Bmp280Reader {
 public:
  bool begin(TwoWire &wire, uint8_t address) {
    wire_ = &wire;
    address_ = address;
    ready_ = false;
    for (uint8_t attempt = 0; attempt < 2; ++attempt) {
      if (beginOnce()) { ready_ = true; return true; }
      delay(10);
    }
    return false;
  }

  bool read(float &temperature, float &pressureHpa) {
    temperature = pressureHpa = NAN;
    if (!ready_) { ++failedReads_; return fail("not_started"); }
    for (uint8_t attempt = 0; attempt < 2; ++attempt) {
      if (readOnce(temperature, pressureHpa)) {
        if (attempt) ++recoveredReads_;
        return true;
      }
      if (!attempt) delay(10);
    }
    temperature = pressureHpa = NAN;
    ++failedReads_;
    ready_ = false;
    return false;
  }

  bool probeId(uint8_t &id) {
    id = 0;
    // A diagnostic probe must not overwrite the last measurement error.
    const char *previous = error_;
    const bool ok = readRegisters(0xD0, &id, 1) && id == 0x58;
    error_ = previous;
    return ok;
  }
  const char *error() const { return error_; }
  uint32_t recoveredReads() const { return recoveredReads_; }
  uint32_t failedReads() const { return failedReads_; }

 private:
  TwoWire *wire_ = nullptr;
  uint8_t address_ = 0;
  bool ready_ = false;
  const char *error_ = "not_started";
  uint32_t recoveredReads_ = 0, failedReads_ = 0;
  uint16_t t1_ = 0, p1_ = 0;
  int16_t t2_ = 0, t3_ = 0, p2_ = 0, p3_ = 0, p4_ = 0;
  int16_t p5_ = 0, p6_ = 0, p7_ = 0, p8_ = 0, p9_ = 0;

  bool fail(const char *message) { error_ = message; return false; }
  bool readRegisters(uint8_t reg, uint8_t *bytes, uint8_t length) {
    if (!wire_) return fail("not_started");
    wire_->beginTransmission(address_);
    wire_->write(reg);
    if (wire_->endTransmission() != 0) return fail("pointer_write_failed");
    if (wire_->requestFrom(address_, length) != length) {
      while (wire_->available()) wire_->read();
      return fail("short_read");
    }
    for (uint8_t i = 0; i < length; ++i) bytes[i] = wire_->read();
    return true;
  }
  bool writeRegister(uint8_t reg, uint8_t value) {
    wire_->beginTransmission(address_);
    wire_->write(reg);
    wire_->write(value);
    if (wire_->endTransmission() != 0) return fail("config_write_failed");
    return true;
  }
  bool waitIdle() {
    const uint32_t start = millis();
    do {
      uint8_t status;
      if (!readRegisters(0xF3, &status, 1)) return false;
      if (!(status & 0x09)) return true; // No measurement or NVM copy in progress.
      delay(5);
    } while (millis() - start < 150);
    return fail("busy_timeout");
  }
  static uint16_t u16(const uint8_t *p) { return uint16_t(p[0]) | (uint16_t(p[1]) << 8); }
  static int16_t s16(const uint8_t *p) { return static_cast<int16_t>(u16(p)); }

  bool beginOnce() {
    uint8_t id;
    if (!readRegisters(0xD0, &id, 1)) return false;
    if (id != 0x58) return fail("wrong_chip_id");
    if (!writeRegister(0xF4, 0x00) || !waitIdle()) return false;
    uint8_t trim[24], confirm[24];
    if (!readRegisters(0x88, trim, sizeof(trim)) ||
        !readRegisters(0x88, confirm, sizeof(confirm))) return false;
    if (memcmp(trim, confirm, sizeof(trim))) return fail("unstable_trim");
    t1_ = u16(trim); t2_ = s16(trim+2); t3_ = s16(trim+4);
    p1_ = u16(trim+6); p2_ = s16(trim+8); p3_ = s16(trim+10);
    p4_ = s16(trim+12); p5_ = s16(trim+14); p6_ = s16(trim+16);
    p7_ = s16(trim+18); p8_ = s16(trim+20); p9_ = s16(trim+22);
    if (!t1_ || t1_ == 0xFFFF || !p1_ || p1_ == 0xFFFF) return fail("invalid_trim");
    // Preserve previous sampling: normal mode, temperature/pressure x16,
    // filter off, 0.5 ms standby. Config writes are made while asleep.
    if (!writeRegister(0xF5, 0x00) || !writeRegister(0xF4, 0xB7)) return false;
    uint8_t config[2];
    if (!readRegisters(0xF4, config, sizeof(config))) return false;
    if (config[0] != 0xB7 || config[1] != 0) return fail("config_mismatch");
    delay(100);
    error_ = "none";
    return true;
  }

  bool readOnce(float &temperature, float &pressureHpa) {
    uint8_t frame[6];
    // One burst keeps temperature and pressure from the same shadowed frame.
    if (!readRegisters(0xF7, frame, sizeof(frame))) return false;
    const uint32_t rawP = (uint32_t(frame[0]) << 12) | (uint32_t(frame[1]) << 4) | (frame[2] >> 4);
    const uint32_t rawT = (uint32_t(frame[3]) << 12) | (uint32_t(frame[4]) << 4) | (frame[5] >> 4);
    if (!rawP || !rawT || rawP == 0x80000 || rawT == 0x80000 ||
        rawP == 0xFFFFF || rawT == 0xFFFFF) return fail("invalid_frame");
    const double offsetT = rawT / 131072.0 - t1_ / 8192.0;
    const double fine = (rawT / 16384.0 - t1_ / 1024.0) * t2_ + offsetT * offsetT * t3_;
    const double temp = fine / 5120.0;
    const double offsetP = static_cast<int32_t>(fine) / 2.0 - 64000.0;
    const double correction = offsetP * offsetP * p6_ / 131072.0 + offsetP * p5_ / 2.0 + p4_ * 65536.0;
    const double divisor = (1.0 + (p3_ * offsetP * offsetP / 524288.0 + p2_ * offsetP) / 17179869184.0) * p1_;
    if (divisor == 0) return fail("invalid_trim");
    double pressure = (1048576.0 - rawP - correction / 4096.0) * 6250.0 / divisor;
    pressure += (p9_ * pressure * pressure / 2147483648.0 + pressure * p8_ / 32768.0 + p7_) / 16.0;
    const double hpa = pressure / 100.0;
    if (!isfinite(temp) || temp < -50 || temp > 150 ||
        !isfinite(hpa) || hpa < 100 || hpa > 1500) return fail("out_of_range");
    temperature = temp;
    pressureHpa = hpa;
    error_ = "none";
    return true;
  }
};
