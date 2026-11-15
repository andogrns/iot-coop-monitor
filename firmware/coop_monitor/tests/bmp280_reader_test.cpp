#include <assert.h>
#include <cmath>
#include <cstring>
#include <iostream>
#include "../bmp280_reader.h"

uint32_t fakeMs = 0;

void put16(TwoWire &wire, uint8_t reg, int value) {
  wire.registers[reg] = value & 255;
  wire.registers[reg+1] = (uint16_t(value) >> 8) & 255;
}
void put20(TwoWire &wire, uint8_t reg, uint32_t value) {
  wire.registers[reg] = value >> 12;
  wire.registers[reg+1] = value >> 4;
  wire.registers[reg+2] = (value & 15) << 4;
}
TwoWire fixture() {
  TwoWire wire;
  wire.registers[0xD0] = 0x58;
  const int trim[] = {27504,26435,-1000,36477,-10685,3024,2855,140,-7,15500,-14600,6000};
  for (uint8_t i = 0; i < 12; ++i) put16(wire, 0x88+2*i, trim[i]);
  put20(wire,0xF7,415148); put20(wire,0xFA,519888);
  return wire;
}
int main() {
  float t = 123, p = 456;
  Bmp280Reader bmp;
  assert(!bmp.read(t,p) && std::isnan(t) && std::isnan(p));
  TwoWire wire = fixture();
  assert(bmp.begin(wire,0x77));
  assert(wire.registers[0xF4] == 0xB7 && wire.registers[0xF5] == 0);
  uint8_t id;
  assert(bmp.probeId(id) && id == 0x58);
  assert(bmp.read(t,p));
  // Bosch's reference trim/raw example, independently calculated values.
  assert(std::fabs(t - 25.0824779f) < 0.0001f);
  assert(std::fabs(p - 1006.53258f) < 0.001f);
  wire.results = {4,0};
  assert(bmp.read(t,p) && bmp.recoveredReads() == 1);
  wire.shortRead = true;
  assert(!bmp.read(t,p) && std::isnan(t) && std::isnan(p));
  assert(!wire.available() && !std::strcmp(bmp.error(),"short_read"));
  wire.shortRead = false;
  assert(bmp.begin(wire,0x77));
  wire.writeResult = 4;
  assert(!bmp.read(t,p) && std::isnan(t) && std::isnan(p));
  wire.writeResult = 0;
  assert(bmp.begin(wire,0x77));
  put20(wire,0xFA,0x80000);
  assert(!bmp.read(t,p) && std::isnan(t) && std::isnan(p));

  TwoWire invalid = fixture();
  invalid.registers[0xD0] = 0x60;
  assert(!bmp.begin(invalid,0x77) && !std::strcmp(bmp.error(),"wrong_chip_id"));
  invalid = fixture(); put16(invalid,0x8E,0);
  assert(!bmp.begin(invalid,0x77) && !std::strcmp(bmp.error(),"invalid_trim"));
  invalid = fixture(); invalid.changeTrim = true;
  assert(!bmp.begin(invalid,0x77) && !std::strcmp(bmp.error(),"unstable_trim"));
  invalid = fixture(); invalid.registers[0xF3] = 0x01;
  const uint32_t start = fakeMs;
  assert(!bmp.begin(invalid,0x77) && !std::strcmp(bmp.error(),"busy_timeout"));
  assert(fakeMs - start <= 320);
  std::cout << "BMP280 compensation, identity, trim, short reads, retries and timeout tests passed\n";
}
