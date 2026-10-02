#include <stdint.h>
#include <cassert>
#include <iostream>
#include "../flash_storage.h"
int main() {
  LittleFS.state = HostFs{};
  FlashStorage storage;
  assert(storage.mount());
  coop::Queue queue(storage);
  assert(queue.recover());
  assert(!storage.initializeEmpty()); // Never erase a mounted volume.
  for (unsigned i = 0; i < 10000; ++i) {
    coop::Record record{}; record.sample = i;
    assert(queue.push(record));
  }
  assert(queue.pending() == 4096 && queue.dropped() == 5904);
  size_t segments = 0, bytes = 0;
  for (const auto &entry : LittleFS.state.files) {
    if (entry.first.find("/queue/") == 0) { ++segments; bytes += entry.second.size(); }
  }
  assert(segments <= 65 && bytes <= (4096 + 63) * 128);
  // Simulate an interrupted append after the last committed full record.
  auto last = LittleFS.state.files.lower_bound("/queue/FFFFFFFFFFFFFFFF.bin");
  --last;
  assert(last->first.find("/queue/") == 0);
  const size_t committedBytes = last->second.size();
  const std::string lastPath = last->first;
  last->second.insert(last->second.end(), 37, 0xA5);
  FlashStorage restarted;
  assert(restarted.mount());
  coop::Queue recovered(restarted);
  assert(recovered.recover());
  assert(LittleFS.state.files.at(lastPath).size() == committedBytes);
  assert(recovered.pending() == 4096 && recovered.dropped() == 5904);
  coop::Record batch[20]; size_t count;
  assert(recovered.batch(batch, 20, count) && count == 20);
  assert(batch[0].sequence == 5905 && batch[19].sequence == 5924);
  assert(recovered.acknowledge(batch[19].sequence));
  assert(recovered.pending() == 4076);
  // A metadata replacement failure cannot acknowledge/remove pending records.
  LittleFS.state.failRename = true;
  assert(!recovered.acknowledge(5944));
  LittleFS.state.failRename = false;
  coop::Queue afterFailure(restarted);
  assert(afterFailure.recover() && afterFailure.pending() == 4076);
  auto first = LittleFS.state.files.lower_bound("/queue/");
  assert(first->first.find("/queue/") == 0);
  first->second[60] ^= 0x40;
  coop::Queue corrupt(restarted);
  assert(!corrupt.recover());
  assert(LittleFS.state.formats == 0);
  LittleFS.state = HostFs{};
  LittleFS.state.mountable = false;
  FlashStorage unmounted;
  assert(!unmounted.mount() && LittleFS.state.formats == 0);
  assert(unmounted.initializeEmpty() && LittleFS.state.formats == 1);
  std::cout << "FlashStorage adapter: overflow/reclamation, short-tail recovery, "
               "rename failure, corruption refusal and no automatic format passed.\n";
}
