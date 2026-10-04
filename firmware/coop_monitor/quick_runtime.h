#pragma once
#include <Preferences.h>
#include "quick_session.h"
namespace quick {
class NvsStore : public Store {
 public:
  bool read(unsigned slot, Metadata &m) override {
    Preferences prefs;
    if (!prefs.begin("cooptest", true)) return false;
    const char *key = slot ? "session_b" : "session_a";
    const bool ok = prefs.getBytesLength(key) == sizeof(m) &&
                    prefs.getBytes(key, &m, sizeof(m)) == sizeof(m);
    prefs.end(); return ok;
  }
  bool write(unsigned slot, const Metadata &m) override {
    Preferences prefs;
    if (!prefs.begin("cooptest", false)) return false;
    const bool ok = prefs.putBytes(slot ? "session_b" : "session_a", &m, sizeof(m)) == sizeof(m);
    prefs.end(); return ok;
  }
  bool exists() override {
    Preferences prefs;
    if (!prefs.begin("cooptest", true)) return false;
    const bool found = prefs.isKey("session_a") || prefs.isKey("session_b");
    prefs.end(); return found;
  }
};
static NvsStore store;
static Session session(store);
static HoldButton button;
struct Scan { const Metadata *session; uint32_t count = 0, last = 0; };
inline bool scanRecord(const coop::Record &record, void *context) {
  Scan &scan = *static_cast<Scan *>(context);
  if (!memcmp(record.reserved, scan.session->id, 16)) {
    if (record.reserved[20] != 1 || elapsed(record) >= scan.session->durationMs) return false;
    ++scan.count; scan.last = elapsed(record);
  }
  return true;
}
inline bool recover(FlashStorage &storage, coop::Queue &queue) {
  if (!queue.ready() || !session.load()) return false;
  Scan scan; scan.session = &session.data();
  if (!storage.scan(scanRecord, &scan)) { session.invalidate(); return false; }
  return session.restore(queue.pending(), scan.count, scan.last);
}
} // namespace quick
