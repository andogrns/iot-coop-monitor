#pragma once

#include <Arduino.h>
#include <Wire.h>

// The replacement SSD1306 panel passed at 10 kHz with short transactions.
// Check actual command/data transfers; Adafruit begin() only checks allocation.
class OledTransport {
 public:
  bool begin(TwoWire &wire, uint8_t address) {
    wire_ = &wire;
    address_ = address;
    wire_->setClock(10000);
    const uint8_t init[] = {
      0xAE, 0xD5, 0x80, 0xA8, 0x3F, 0xD3, 0x00, 0x40,
      0x8D, 0x14, 0x20, 0x02, // SSD1306 pump on, page addressing.
      0xA1, 0xC8, 0xDA, 0x12, 0x81, 0xCF, 0xD9, 0xF1,
      0xDB, 0x40, 0xA4, 0xA6, 0x2E, 0xAF
    };
    for (uint8_t byte : init) {
      bool ok = false;
      for (uint8_t attempt = 0; attempt < 3 && !ok; ++attempt) {
        ok = transfer(0x00, &byte, 1);
        if (!ok) delay(2);
      }
      if (!ok) return false;
    }
    delay(100);
    return true;
  }

  bool show(const uint8_t *buffer) {
    if (!wire_ || !buffer) return false;
    wire_->setClock(10000);
    for (uint8_t page = 0; page < 8; ++page) {
      for (uint8_t column = 0; column < 128; column += 16) {
        // Reposition each chunk on every attempt. A partially accepted frame
        // cannot shift the remainder of the display after a transfer failure.
        const uint8_t position[] = {uint8_t(0xB0 | page), uint8_t(column & 15), uint8_t(0x10 | (column >> 4))};
        bool ok = false;
        for (uint8_t attempt = 0; attempt < 3 && !ok; ++attempt) {
          ok = transfer(0x00, position, sizeof(position)) &&
               transfer(0x40, buffer + size_t(page) * 128 + column, 16);
          if (!ok) delay(2);
        }
        if (!ok) return false;
      }
    }
    return true;
  }

  uint8_t lastResult() const { return lastResult_; }

 private:
  TwoWire *wire_ = nullptr;
  uint8_t address_ = 0;
  uint8_t lastResult_ = 0;
  bool transfer(uint8_t control, const uint8_t *bytes, size_t length) {
    wire_->beginTransmission(address_);
    wire_->write(control);
    wire_->write(bytes, length);
    lastResult_ = wire_->endTransmission();
    return lastResult_ == 0;
  }
};
