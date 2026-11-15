#include <assert.h>
#include <cmath>
#include <cstring>
#include <iostream>
#include "../aht20_reader.h"

uint32_t fakeMs = 0;

int main() {
  float t = 123, h = 456;
  Aht20Reader notStarted;
  assert(!notStarted.read(t,h) && std::isnan(t) && std::isnan(h));

  TwoWire wire;
  Aht20Reader aht;
  assert(aht.begin(wire));
  assert(wire.commands.empty()); // No unnecessary reset of an initialized sensor.
  const auto start = fakeMs;
  assert(aht.read(t,h));
  assert(fakeMs - start >= 80);
  assert(std::fabs(t - 27.2278f) < 0.01f);
  assert(std::fabs(h - 50.3919f) < 0.01f);
  assert(wire.commands.back() == std::vector<uint8_t>({0xAC,0x33,0x00}));

  wire.frame[2] ^= 1;
  assert(!aht.read(t,h) && std::isnan(t) && std::isnan(h));
  assert(std::strcmp(aht.error(), "crc_mismatch") == 0);
  wire.frame.assign(7,0); // Old driver could accept this as -50 C / 0% RH.
  assert(!aht.read(t,h) && std::isnan(t));
  wire.frame.assign(3,0x18);
  assert(!aht.read(t,h) && std::strcmp(aht.error(), "short_frame") == 0);
  wire.status = 0x80;
  const auto busyStart = fakeMs;
  assert(!aht.read(t,h));
  assert(fakeMs - busyStart == 330); // 80 ms conversion + bounded 250 ms poll.
  assert(std::strcmp(aht.error(), "busy_timeout") == 0);
  wire.status = 0x18;
  wire.writeResult = 2;
  assert(!aht.read(t,h) && std::strcmp(aht.error(), "write_failed") == 0);
  wire.writeResult = 0;
  wire.missing = true;
  assert(!aht.read(t,h) && std::strcmp(aht.error(), "status_read_failed") == 0);

  TwoWire cold;
  cold.status = 0x10;
  assert(aht.begin(cold));
  assert(cold.commands.size() == 1);
  assert(cold.commands[0] == std::vector<uint8_t>({0xBE,0x08,0x00}));
  cold.status = 0x10;
  cold.initializeOnBe = false;
  assert(!aht.begin(cold) && std::strcmp(aht.error(), "not_initialized") == 0);
  cold.missing = true;
  assert(!aht.begin(cold));

  TwoWire flaky;
  Aht20Reader retrying;
  assert(retrying.begin(flaky));
  flaky.results = {4,0}; // First trigger fails; a fresh full conversion succeeds.
  const auto retryStart = fakeMs;
  assert(retrying.read(t,h));
  assert(flaky.commands.size() == 2);
  assert(fakeMs - retryStart >= 90);
  assert(retrying.recoveredReads() == 1 && retrying.failedReads() == 0);
  assert(std::fabs(t - 27.2278f) < 0.01f);
  flaky.writeResult = 4;
  assert(!retrying.read(t,h) && std::isnan(t) && std::isnan(h));
  assert(retrying.recoveredReads() == 1 && retrying.failedReads() == 1);
  flaky.writeResult = 0;
  flaky.frame[2] ^= 1;
  assert(!retrying.read(t,h) && std::isnan(t) && std::isnan(h));
  assert(retrying.failedReads() == 2 && std::strcmp(retrying.error(), "crc_mismatch") == 0);
  std::cout << "AHT20 timing, initialization, decoding, CRC, timeout and I/O failure tests passed\n";
}
