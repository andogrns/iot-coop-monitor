#include <assert.h>
#include <iostream>
#include "../oled_transport.h"

uint32_t fakeMs = 0;

int main() {
  OledTransport oled;
  uint8_t buffer[1024];
  for (size_t i=0; i<sizeof(buffer); ++i) buffer[i] = uint8_t(i);
  assert(!oled.show(buffer));
  TwoWire wire;
  assert(oled.begin(wire,0x3C));
  assert(wire.clock == 10000 && wire.commands.size() == 26);
  assert(wire.commands[0] == std::vector<uint8_t>({0,0xAE}));
  assert(wire.commands.back() == std::vector<uint8_t>({0,0xAF}));
  wire.commands.clear();
  assert(oled.show(buffer));
  assert(wire.commands.size() == 128);
  assert(wire.commands[0] == std::vector<uint8_t>({0,0xB0,0,0x10}));
  assert(wire.commands[1].size() == 17 && wire.commands[1][0] == 0x40);
  for (size_t i=0; i<16; ++i) assert(wire.commands[1][i+1] == buffer[i]);
  assert(wire.commands[14] == std::vector<uint8_t>({0,0xB0,0,0x17}));
  assert(wire.commands[126] == std::vector<uint8_t>({0,0xB7,0,0x17}));

  wire.commands.clear();
  wire.results = {0,4,0,0}; // Position accepted, data failed, reposition and retry.
  assert(oled.show(buffer));
  assert(wire.commands.size() == 130);
  assert(wire.commands[0] == wire.commands[2]);
  assert(wire.commands[1] == wire.commands[3]);

  wire.commands.clear();
  wire.writeResult = 4;
  const auto start = fakeMs;
  assert(!oled.show(buffer));
  assert(wire.commands.size() == 3 && fakeMs - start == 6);
  assert(oled.lastResult() == 4);
  wire.commands.clear();
  assert(!oled.begin(wire,0x3C) && wire.commands.size() == 3);
  wire.writeResult = 0;
  wire.commands.clear();
  wire.results = {4,0}; // An initial transient is recoverable.
  assert(oled.begin(wire,0x3C) && wire.commands.size() == 27);
  assert(!oled.show(nullptr));
  std::cout << "OLED page/chunk layout, repositioned retries and bounded failure tests passed\n";
}
