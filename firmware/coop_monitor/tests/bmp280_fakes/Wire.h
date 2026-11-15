#pragma once
#include "Arduino.h"
#include <array>
#include <vector>
#include <deque>

class TwoWire {
 public:
  std::array<uint8_t, 256> registers{};
  std::deque<uint8_t> results;
  bool missing = false, shortRead = false, changeTrim = false;
  uint8_t writeResult = 0;
  void beginTransmission(uint8_t) { command.clear(); }
  size_t write(uint8_t byte) { command.push_back(byte); return 1; }
  uint8_t endTransmission() {
    const uint8_t result = results.empty() ? writeResult : results.front();
    if (!results.empty()) results.pop_front();
    if (result) return result;
    pointer = command.at(0);
    if (command.size() == 2) registers[pointer] = command[1];
    return 0;
  }
  size_t requestFrom(uint8_t, uint8_t count) {
    data.clear(); position = 0;
    if (missing) return 0;
    if (shortRead) --count;
    for (uint8_t i = 0; i < count; ++i) data.push_back(registers[uint8_t(pointer+i)]);
    if (changeTrim && pointer == 0x88) ++registers[0x89];
    return data.size();
  }
  int available() { return int(data.size() - position); }
  int read() { return data.at(position++); }
 private:
  uint8_t pointer = 0;
  std::vector<uint8_t> command, data;
  size_t position = 0;
};
