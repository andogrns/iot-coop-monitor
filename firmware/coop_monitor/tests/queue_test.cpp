#include "../queue_core.h"
#include <cassert>
#include <cstdio>
#include <vector>

class MemoryStorage : public coop::Storage {
 public:
  coop::Metadata meta[2]{};
  bool present[2]{};
  std::vector<coop::Record> records;
  bool failMetadata = false, loseAppendReply = false, failAppend = false;
  bool readMetadata(unsigned slot, coop::Metadata &m) override {
    m = meta[slot]; return present[slot];
  }
  bool writeMetadata(unsigned slot, const coop::Metadata &m) override {
    if (failMetadata) { failMetadata = false; return false; }
    meta[slot] = m; present[slot] = true; return true;
  }
  bool scan(bool (*visit)(const coop::Record &, void *), void *context) override {
    for (const auto &r : records) if (!visit(r, context)) return false;
    return true;
  }
  bool append(const coop::Record &r) override {
    if (failAppend) { failAppend = false; return false; }
    records.push_back(r);
    if (loseAppendReply) { loseAppendReply = false; return false; }
    return true;
  }
  bool readAfter(uint64_t through, coop::Record *out, size_t capacity, size_t &count) override {
    count = 0;
    for (const auto &r : records) if (r.sequence > through && count < capacity) {
      if (!coop::valid(r)) return false;
      out[count++] = r;
    }
    return true;
  }
  bool prune(uint64_t through) override {
    while (!records.empty() && records.front().sequence / 64 * 64 + 63 <= through)
      records.erase(records.begin());
    return true;
  }
};
static coop::Record record(unsigned sample) {
  coop::Record r{}; r.sample = sample; r.boot[0] = 9; return r;
}
int main() {
  MemoryStorage store;
  coop::Queue queue(store);
  assert(queue.recover());
  for (unsigned i = 1; i <= 4096; ++i) assert(queue.push(record(i)));
  assert(queue.pending() == 4096 && queue.dropped() == 0);
  assert(queue.push(record(4097)));
  assert(queue.pending() == 4096 && queue.dropped() == 1);
  coop::Record batch[20]; size_t count;
  assert(queue.batch(batch, 20, count) && count == 20 && batch[0].sample == 2);
  // Upload reply loss: nothing is removed without an explicit acknowledgement.
  coop::Queue restarted(store); assert(restarted.recover());
  assert(restarted.batch(batch, 20, count) && batch[0].sample == 2);
  const uint64_t last = batch[count - 1].sequence;
  assert(restarted.acknowledge(last));
  assert(restarted.pending() == 4076);
  coop::Queue afterAck(store); assert(afterAck.recover());
  assert(afterAck.batch(batch, 20, count) && batch[0].sample == 22);
  // Failed acknowledgement checkpoint must retain records for a safe retry.
  store.failMetadata = true;
  assert(!afterAck.acknowledge(batch[count - 1].sequence));
  coop::Queue retry(store); assert(retry.recover());
  assert(retry.batch(batch, 20, count) && batch[0].sample == 22);
  // Record persisted but power went away before a new metadata checkpoint.
  store.loseAppendReply = true; assert(!retry.push(record(4098)));
  coop::Queue appendRecovery(store); assert(appendRecovery.recover());
  assert(appendRecovery.pending() == 4077);
  // Empty queues retain the sequence watermark across reboot.
  assert(appendRecovery.acknowledge(4098));
  coop::Queue emptyRecovery(store); assert(emptyRecovery.recover());
  assert(emptyRecovery.pending() == 0 && emptyRecovery.push(record(4099)));
  assert(emptyRecovery.batch(batch, 20, count) && count == 1 && batch[0].sequence == 4099);
  // Older valid metadata copy survives a torn newer checkpoint.
  const unsigned newest = store.meta[0].generation > store.meta[1].generation ? 0 : 1;
  store.meta[newest].crc ^= 1;
  coop::Queue tornMetadata(store); assert(tornMetadata.recover());
  assert(tornMetadata.pending() == 1);
  // Corrupt complete records stop recovery rather than erasing the log.
  store.records.back().crc ^= 1;
  coop::Queue corrupt(store); assert(!corrupt.recover() && !corrupt.ready());
  assert(!store.records.empty());
  // No valid metadata plus existing records is an explicit storage fault.
  store.records.back().crc ^= 1; store.present[0] = store.present[1] = false;
  coop::Queue noMetadata(store); assert(!noMetadata.recover());
  // Long outage: multiple complete wraps still keep exactly the latest 4096.
  MemoryStorage longStore; coop::Queue longQueue(longStore); assert(longQueue.recover());
  for (unsigned i = 1; i <= 10000; ++i) assert(longQueue.push(record(i)));
  assert(longQueue.pending() == 4096 && longQueue.dropped() == 5904);
  assert(longQueue.batch(batch, 20, count) && batch[0].sample == 5905);
  assert(sizeof(coop::Record) * coop::QUEUE_CAPACITY == 524288);
  std::puts("PASS: durable queue restart, overflow, acknowledgement loss, checkpoint failures, CRC faults; 4096 x 128 = 524288 bytes.");
}
