#pragma once
#include <LittleFS.h>
#include "queue_core.h"

class FlashStorage : public coop::Storage {
 public:
  bool mount() {
    mounted_ = LittleFS.begin(false); // Never format a failed mount.
    if (mounted_ && !LittleFS.exists("/queue")) mounted_ = LittleFS.mkdir("/queue");
    return mounted_;
  }
  bool initializeEmpty() {
    // Explicit initial provisioning only; a mounted filesystem is never erased.
    if (mounted_) return false;
    if (!LittleFS.format()) return false;
    return mount();
  }
  bool mounted() const { return mounted_; }
  bool readMetadata(unsigned slot, coop::Metadata &m) override {
    File f = LittleFS.open(slot ? "/meta.b" : "/meta.a", "r");
    if (!f || f.size() != sizeof(m)) return false;
    return f.read(reinterpret_cast<uint8_t *>(&m), sizeof(m)) == sizeof(m);
  }
  bool writeMetadata(unsigned slot, const coop::Metadata &m) override {
    File f = LittleFS.open("/meta.tmp", "w");
    if (!f || f.write(reinterpret_cast<const uint8_t *>(&m), sizeof(m)) != sizeof(m))
      return false;
    f.flush();
    f.close();
    return LittleFS.rename("/meta.tmp", slot ? "/meta.b" : "/meta.a");
  }
  bool append(const coop::Record &r) override {
    char path[40];
    segmentPath(r.sequence / coop::RECORDS_PER_SEGMENT, path);
    File f = LittleFS.open(path, "a");
    if (!f || f.size() % sizeof(r) != 0 || f.size() >= sizeof(r) * 64) return false;
    if (f.write(reinterpret_cast<const uint8_t *>(&r), sizeof(r)) != sizeof(r)) return false;
    f.flush();
    f.close();
    return true;
  }
  bool scan(bool (*visitor)(const coop::Record &, void *), void *context) override {
    Segment segments[MAX_SEGMENTS];
    size_t count;
    if (!list(segments, count)) return false;
    uint64_t previous = 0;
    for (size_t i = 0; i < count; ++i) {
      char path[40]; segmentPath(segments[i].bucket, path);
      File f = LittleFS.open(path, "r");
      if (!f) return false;
      const size_t size = f.size();
      const size_t complete = size / sizeof(coop::Record);
      if (complete > 64) return false;
      coop::Record r;
      for (size_t n = 0; n < complete; ++n) {
        if (f.read(reinterpret_cast<uint8_t *>(&r), sizeof(r)) != sizeof(r) ||
            !coop::valid(r) || r.sequence <= previous ||
            r.sequence / 64 != segments[i].bucket || !visitor(r, context)) return false;
        previous = r.sequence;
      }
      f.close();
      // A short final record is an interrupted append. Preserve the committed
      // prefix by replacing this one segment, never by formatting the volume.
      if (size % sizeof(coop::Record) && !repairTail(path, complete * sizeof(r))) return false;
    }
    return true;
  }
  bool readAfter(uint64_t through, coop::Record *records, size_t capacity,
                 size_t &count) override {
    count = 0;
    Segment segments[MAX_SEGMENTS]; size_t length;
    if (!list(segments, length)) return false;
    for (size_t i = 0; i < length && count < capacity; ++i) {
      if (segments[i].bucket * 64 + 63 <= through) continue;
      char path[40]; segmentPath(segments[i].bucket, path);
      File f = LittleFS.open(path, "r");
      if (!f || f.size() % sizeof(coop::Record)) return false;
      coop::Record r;
      while (f.available() && count < capacity) {
        if (f.read(reinterpret_cast<uint8_t *>(&r), sizeof(r)) != sizeof(r) ||
            !coop::valid(r)) return false;
        if (r.sequence > through) records[count++] = r;
      }
    }
    return true;
  }
  bool prune(uint64_t through) override {
    Segment segments[MAX_SEGMENTS]; size_t count;
    if (!list(segments, count)) return false;
    for (size_t i = 0; i < count; ++i) {
      // Keep the current (possibly partial) segment to avoid reopening sequence
      // numbers in a different physical file after an empty-queue restart.
      if (segments[i].bucket * 64 + 63 <= through) {
        char path[40]; segmentPath(segments[i].bucket, path);
        if (!LittleFS.remove(path)) return false;
      }
    }
    return true;
  }
 private:
  struct Segment { uint64_t bucket; };
  static constexpr size_t MAX_SEGMENTS = 80;
  bool mounted_ = false;
  static void segmentPath(uint64_t bucket, char *path) {
    snprintf(path, 40, "/queue/%016llX.bin", (unsigned long long)bucket);
  }
  bool list(Segment *segments, size_t &count) {
    count = 0;
    File root = LittleFS.open("/queue", "r");
    if (!root || !root.isDirectory()) return false;
    File entry = root.openNextFile();
    while (entry) {
      const char *name = strrchr(entry.name(), '/');
      name = name ? name + 1 : entry.name();
      if (strlen(name) == 20 && strcmp(name + 16, ".bin") == 0) {
        if (count == MAX_SEGMENTS || entry.isDirectory()) return false;
        char *end;
        const uint64_t bucket = strtoull(name, &end, 16);
        if (end != name + 16) return false;
        segments[count++].bucket = bucket;
      }
      entry = root.openNextFile();
    }
    for (size_t i = 1; i < count; ++i) {
      Segment s = segments[i]; size_t j = i;
      while (j && segments[j - 1].bucket > s.bucket) {
        segments[j] = segments[j - 1]; --j;
      }
      segments[j] = s;
    }
    return true;
  }
  bool repairTail(const char *path, size_t length) {
    File source = LittleFS.open(path, "r");
    File target = LittleFS.open("/repair.tmp", "w");
    if (!source || !target) return false;
    uint8_t buffer[256];
    while (length) {
      const size_t n = length < sizeof(buffer) ? length : sizeof(buffer);
      if (source.read(buffer, n) != n || target.write(buffer, n) != n) return false;
      length -= n;
    }
    target.flush(); source.close(); target.close();
    return LittleFS.rename("/repair.tmp", path);
  }
};
