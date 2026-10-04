#pragma once
#include "queue_core.h"
#include <math.h>
#include <stdio.h>

namespace quick {
enum Phase : uint8_t { IDLE, ARMED, RECORDING, COMPLETED, STOPPED, INTERRUPTED, STORAGE_ERROR };
struct CalibrationSnapshot {
  float baselineMv, thresholdMv, sdMv;
  uint32_t samples;
  float temperatureC, humidityPercent;
};
#pragma pack(push, 1)
struct Metadata {
  uint32_t magic;
  uint16_t version;
  uint8_t phase, flags;
  uint64_t generation;
  uint8_t id[16];
  uint32_t durationMs, saved, elapsedMs;
  CalibrationSnapshot calibration;
  uint8_t reserved[56];
  uint32_t crc;
};
#pragma pack(pop)
static_assert(sizeof(Metadata) == 128, "Session checkpoint size changed");
static_assert(sizeof(CalibrationSnapshot) == 24, "Calibration snapshot size changed");
constexpr uint32_t MAGIC = 0x51545331;
constexpr uint32_t INTERVAL_MS = 2000;
inline const char *phaseName(uint8_t phase) {
  static const char *names[] = {"Idle", "Armed", "Recording", "Completed", "Stopped", "Interrupted", "Storage error"};
  return phase <= STORAGE_ERROR ? names[phase] : "Invalid";
}
inline bool valid(const Metadata &m) {
  return m.magic == MAGIC && m.version == 1 && m.phase <= STORAGE_ERROR &&
    (m.phase == IDLE || m.durationMs == 900000 || m.durationMs == 1800000) &&
    m.saved <= 900 && m.elapsedMs <= m.durationMs &&
    m.crc == coop::crc32(&m, offsetof(Metadata, crc));
}
class Store {
 public:
  virtual ~Store() {}
  virtual bool read(unsigned slot, Metadata &value) = 0;
  virtual bool write(unsigned slot, const Metadata &value) = 0;
  virtual bool exists() = 0;
};
class Session {
 public:
  explicit Session(Store &store) : store_(store) {}
  bool load() {
    Metadata a{}, b{};
    const bool av = store_.read(0, a) && valid(a), bv = store_.read(1, b) && valid(b);
    if (!av && !bv) {
      if (store_.exists()) return fail();
      data_ = {}; data_.magic = MAGIC; data_.version = 1;
      if (!save(data_)) return false;
    } else data_ = av && (!bv || a.generation >= b.generation) ? a : b;
    ready_ = true; return true;
  }
  bool restore(uint32_t pending, uint32_t matched, uint32_t lastElapsed) {
    if (!ready_ || pending > matched || (pending && data_.phase <= ARMED)) return fail();
    if (data_.phase == RECORDING || data_.phase == STORAGE_ERROR) {
      Metadata next = data_;
      next.saved = matched; next.elapsedMs = lastElapsed;
      if (next.phase == RECORDING) next.phase = INTERRUPTED;
      return save(next);
    }
    return pending <= data_.saved ? true : fail();
  }
  bool arm(unsigned minutes, const uint8_t *id, const CalibrationSnapshot &cal,
           bool queueReady, uint32_t pending) {
    if (!ready_ || !queueReady || pending || data_.phase == RECORDING ||
        (minutes != 15 && minutes != 30) || !isfinite(cal.baselineMv) ||
        !isfinite(cal.thresholdMv) || !isfinite(cal.sdMv) || cal.baselineMv < 10 ||
        cal.thresholdMv <= cal.baselineMv || cal.thresholdMv >= 2400 ||
        cal.sdMv < 0 || cal.samples < 60) return false;
    Metadata next{};
    next.magic = MAGIC; next.version = 1; next.phase = ARMED;
    memcpy(next.id, id, sizeof(next.id)); next.durationMs = minutes * 60000;
    next.calibration = cal;
    return save(next);
  }
  bool start(uint32_t now) {
    if (!ready_ || data_.phase != ARMED) return false;
    Metadata next = data_; next.phase = RECORDING;
    if (!save(next)) return false;
    startMs_ = now; lastRecordMs_ = now; hasRecord_ = false; return true;
  }
  bool tick(uint32_t now) {
    if (!ready_) return false;
    if (data_.phase == RECORDING && now - startMs_ >= data_.durationMs)
      return finish(COMPLETED, data_.durationMs);
    return ready_;
  }
  bool due(uint32_t now) const {
    return ready_ && data_.phase == RECORDING && now - startMs_ < data_.durationMs &&
           (!hasRecord_ || now - lastRecordMs_ >= INTERVAL_MS);
  }
  void committed(uint32_t now) {
    ++data_.saved; data_.elapsedMs = now - startMs_;
    lastRecordMs_ = now; hasRecord_ = true;
  }
  bool stop(uint32_t now) {
    if (!ready_) return false;
    if (data_.phase == ARMED) { Metadata next = data_; next.phase = IDLE; return save(next); }
    return data_.phase == RECORDING && finish(STOPPED, now - startMs_);
  }
  bool storageError(uint32_t now) { return finish(STORAGE_ERROR, now - startMs_); }
  bool closed() const { return ready_ && data_.phase >= COMPLETED; }
  void invalidate() { ready_ = false; }
  bool ready() const { return ready_; }
  uint32_t elapsed(uint32_t now) const {
    return data_.phase == RECORDING ? now - startMs_ : data_.elapsedMs;
  }
  const Metadata &data() const { return data_; }
 private:
  bool finish(Phase phase, uint32_t elapsed) {
    if (!ready_) return false;
    Metadata next = data_; next.phase = phase;
    next.elapsedMs = elapsed > next.durationMs ? next.durationMs : elapsed;
    return save(next);
  }
  bool save(Metadata next) {
    next.generation = data_.generation + 1;
    next.crc = coop::crc32(&next, offsetof(Metadata, crc));
    if (!store_.write(next.generation & 1, next)) return fail();
    data_ = next; return true;
  }
  bool fail() { ready_ = false; return false; }
  Store &store_; Metadata data_{};
  bool ready_ = false, hasRecord_ = false;
  uint32_t startMs_ = 0, lastRecordMs_ = 0;
};
inline void encode(coop::Record &record, const Metadata &session, uint32_t elapsed) {
  memcpy(record.reserved, session.id, 16);
  memcpy(record.reserved + 16, &elapsed, sizeof(elapsed));
  record.reserved[20] = 1;
}
inline uint32_t elapsed(const coop::Record &record) {
  uint32_t value; memcpy(&value, record.reserved + 16, sizeof(value)); return value;
}
inline void idText(const uint8_t *id, char *text) {
  for (unsigned n = 0; n < 16; ++n) snprintf(text + n * 2, 3, "%02x", id[n]);
}
// Release must be observed first, so holding BOOT during power-on cannot stop a test.
class HoldButton {
 public:
  bool update(uint32_t now, bool down) {
    if (!down) { released_ = true; holding_ = fired_ = false; return false; }
    if (!released_) return false;
    if (!holding_) { holding_ = true; since_ = now; }
    if (!fired_ && now - since_ >= 2000) { fired_ = true; return true; }
    return false;
  }
 private:
  bool released_ = false, holding_ = false, fired_ = false;
  uint32_t since_ = 0;
};
} // namespace quick
