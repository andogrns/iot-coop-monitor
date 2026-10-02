#pragma once
#include <stdint.h>
#include <stddef.h>
#include <string.h>

namespace coop {
constexpr uint32_t RECORD_MAGIC = 0x43515231;
constexpr uint32_t META_MAGIC = 0x43514D31;
constexpr uint32_t QUEUE_CAPACITY = 4096;
constexpr uint32_t RECORDS_PER_SEGMENT = 64;
constexpr uint32_t BATCH_SIZE = 20;

#pragma pack(push, 1)
struct Record {
  uint32_t magic;
  uint16_t version;
  uint16_t status;
  uint64_t sequence;
  uint8_t boot[16];
  uint32_t sample;
  uint64_t uptimeMs;
  int64_t sampledUtcMs; // 0 means the clock was not synchronized.
  uint16_t mqRaw;
  uint16_t mqAdcMv;
  float mqModuleV, mqRatio, ahtTemperatureC, humidityPercent;
  float bmpTemperatureC, pressureHpa;
  uint8_t reason; // 0 periodic, 1 sensor status change.
  uint8_t reserved[35];
  uint64_t droppedTotal;
  uint32_t crc;
};
struct Metadata {
  uint32_t magic;
  uint16_t version;
  uint16_t reserved;
  uint64_t generation;
  uint64_t nextSequence;
  uint64_t consumedThrough;
  uint64_t dropped;
  uint8_t padding[20];
  uint32_t crc;
};
#pragma pack(pop)
static_assert(sizeof(Record) == 128, "Queue records must occupy 128 bytes");
static_assert(sizeof(Metadata) == 64, "Metadata format changed");

inline uint32_t crc32(const void *data, size_t length) {
  const uint8_t *bytes = static_cast<const uint8_t *>(data);
  uint32_t crc = 0xFFFFFFFF;
  while (length--) {
    crc ^= *bytes++;
    for (unsigned bit = 0; bit < 8; ++bit)
      crc = (crc >> 1) ^ ((crc & 1) ? 0xEDB88320 : 0);
  }
  return crc ^ 0xFFFFFFFF;
}
inline bool valid(const Record &r) {
  return r.magic == RECORD_MAGIC && r.version == 1 && r.sequence != 0 &&
         r.reason <= 1 && r.crc == crc32(&r, offsetof(Record, crc));
}
inline bool valid(const Metadata &m) {
  return m.magic == META_MAGIC && m.version == 1 && m.nextSequence != 0 &&
         m.consumedThrough < m.nextSequence &&
         m.crc == crc32(&m, offsetof(Metadata, crc));
}

// The implementation and host fault-injection tests share this state machine.
// Storage operations return only after flush/close and atomic metadata rename.
class Storage {
 public:
  virtual ~Storage() {}
  virtual bool readMetadata(unsigned slot, Metadata &m) = 0;
  virtual bool writeMetadata(unsigned slot, const Metadata &m) = 0;
  virtual bool scan(bool (*visitor)(const Record &, void *), void *context) = 0;
  virtual bool append(const Record &r) = 0;
  virtual bool readAfter(uint64_t sequence, Record *records, size_t capacity,
                         size_t &count) = 0;
  virtual bool prune(uint64_t consumedThrough) = 0;
};

class Queue {
 public:
  explicit Queue(Storage &storage) : storage_(storage) {}
  bool recover() {
    ready_ = false;
    Metadata a{}, b{};
    const bool aValid = storage_.readMetadata(0, a) && valid(a);
    const bool bValid = storage_.readMetadata(1, b) && valid(b);
    meta_ = aValid && (!bValid || a.generation >= b.generation) ? a : b;
    if (!aValid && !bValid) {
      meta_ = {};
      meta_.magic = META_MAGIC;
      meta_.version = 1;
      meta_.nextSequence = 1;
    }
    ScanState state{meta_.consumedThrough, 0, 0};
    if (!storage_.scan(scanRecord, &state)) return false;
    // Lost metadata must never silently resurrect an existing log as new.
    if (!aValid && !bValid && state.maximum != 0) return false;
    pending_ = state.count;
    if (state.maximum >= meta_.nextSequence) meta_.nextSequence = state.maximum + 1;
    if (pending_ != meta_.nextSequence - 1 - meta_.consumedThrough) return false;
    if (!checkpoint(meta_)) return false;
    ready_ = true;
    while (pending_ > QUEUE_CAPACITY) if (!discardOldest()) return false;
    if (!storage_.prune(meta_.consumedThrough)) return fail();
    return true;
  }
  bool push(Record r) {
    if (!ready_) return false;
    if (pending_ == QUEUE_CAPACITY && !discardOldest()) return false;
    r.magic = RECORD_MAGIC;
    r.version = 1;
    r.sequence = meta_.nextSequence;
    r.droppedTotal = meta_.dropped;
    r.crc = crc32(&r, offsetof(Record, crc));
    if (!storage_.append(r)) return fail();
    Metadata next = meta_;
    ++next.nextSequence;
    if (!checkpoint(next)) return fail();
    ++pending_;
    return true;
  }
  bool batch(Record *records, size_t capacity, size_t &count) {
    count = 0;
    if (!ready_) return false;
    if (!storage_.readAfter(meta_.consumedThrough, records, capacity, count)) return fail();
    return true;
  }
  bool acknowledge(uint64_t through) {
    if (!ready_ || through >= meta_.nextSequence) return false;
    if (through <= meta_.consumedThrough) return true; // Overflow already retired it.
    const uint64_t consumed = through - meta_.consumedThrough;
    if (consumed > pending_) return fail();
    Metadata next = meta_;
    next.consumedThrough = through;
    if (!checkpoint(next)) return fail();
    pending_ -= static_cast<uint32_t>(consumed);
    if (!storage_.prune(meta_.consumedThrough)) return fail();
    return true;
  }
  bool ready() const { return ready_; }
  uint32_t pending() const { return pending_; }
  uint64_t dropped() const { return meta_.dropped; }
 private:
  struct ScanState { uint64_t consumed, maximum; uint32_t count; };
  static bool scanRecord(const Record &r, void *context) {
    if (!valid(r)) return false;
    ScanState &state = *static_cast<ScanState *>(context);
    if (r.sequence > state.maximum) state.maximum = r.sequence;
    if (r.sequence > state.consumed) ++state.count;
    return true;
  }
  bool checkpoint(Metadata next) {
    next.generation = meta_.generation + 1;
    next.crc = crc32(&next, offsetof(Metadata, crc));
    if (!storage_.writeMetadata(next.generation & 1, next)) return fail();
    meta_ = next;
    return true;
  }
  bool discardOldest() {
    Record oldest{};
    size_t count = 0;
    if (!storage_.readAfter(meta_.consumedThrough, &oldest, 1, count) || count != 1)
      return fail();
    Metadata next = meta_;
    next.consumedThrough = oldest.sequence;
    ++next.dropped;
    if (!checkpoint(next)) return fail();
    --pending_;
    if (!storage_.prune(meta_.consumedThrough)) return fail();
    return true;
  }
  bool fail() { ready_ = false; return false; }
  Storage &storage_;
  Metadata meta_{};
  uint32_t pending_ = 0;
  bool ready_ = false;
};
} // namespace coop
