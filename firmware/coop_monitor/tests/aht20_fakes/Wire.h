#pragma once
#include "Arduino.h"
#include <vector>
#include <deque>

class TwoWire {
 public:
  uint8_t status = 0x18;
  uint8_t writeResult = 0;
  bool missing = false;
  bool initializeOnBe = true;
  uint32_t clock = 0;
  std::deque<uint8_t> results;
  std::vector<uint8_t> frame = {0x18,0x81,0x00,0xD6,0x2D,0xA0,0x13};
  std::vector<std::vector<uint8_t>> commands;
  void beginTransmission(uint8_t) { command.clear(); }
  bool setClock(uint32_t hz) { clock = hz; return true; }
  size_t write(uint8_t byte) { command.push_back(byte); return 1; }
  size_t write(const uint8_t *bytes, size_t length) {
    command.insert(command.end(), bytes, bytes + length);
    return length;
  }
  uint8_t endTransmission() {
    commands.push_back(command);
    const uint8_t result = results.empty() ? writeResult : results.front();
    if (!results.empty()) results.pop_front();
    if (!result && initializeOnBe && command == std::vector<uint8_t>({0xBE,0x08,0x00})) status |= 0x08;
    return result;
  }
  size_t requestFrom(uint8_t, uint8_t count) {
    data = missing ? std::vector<uint8_t>() : count == 1 ? std::vector<uint8_t>({status}) : frame;
    position = 0;
    return data.size();
  }
  int available() { return int(data.size() - position); }
  int read() { return data.at(position++); }
 private:
  std::vector<uint8_t> command, data;
  size_t position = 0;
};
