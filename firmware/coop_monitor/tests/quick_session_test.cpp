#include <cassert>
#include <iostream>
#include "../flash_storage.h"
#include "../quick_session.h"

struct MemoryStore : quick::Store {
  quick::Metadata slots[2]{};
  bool present[2]{}, failWrite = false;
  bool read(unsigned n, quick::Metadata &m) override { m = slots[n]; return present[n]; }
  bool write(unsigned n, const quick::Metadata &m) override {
    if (failWrite) return false;
    slots[n] = m; present[n] = true; return true;
  }
  bool exists() override { return present[0] || present[1]; }
};
const quick::CalibrationSnapshot cal{1000, 1150, 12, 150, 29, 65};
const uint8_t id[16]{1,2,3};
int main() {
  // Execute real session/queue/adapter logic; the stand-in does not prove flash durability.
  for (unsigned minutes : {15u, 30u}) {
    LittleFS.state = HostFs{};
    FlashStorage legacy;
    assert(legacy.mount()); coop::Queue old(legacy); assert(old.recover());
    coop::Record original{}; original.sample = 42; assert(old.push(original));
    const auto oldFiles = LittleFS.state.files;
    FlashStorage fs("/quicktest"); assert(fs.mount());
    coop::Queue queue(fs); assert(queue.recover());
    MemoryStore store; quick::Session arm(store); assert(arm.load());
    assert(!arm.arm(20, id, cal, true, 0));
    assert(!arm.arm(minutes, id, cal, true, 1));
    auto bad = cal; bad.samples = 59; assert(!arm.arm(minutes, id, bad, true, 0));
    assert(arm.arm(minutes, id, cal, true, 0));
    assert(!arm.due(1000)); // Campus samples before next boot are never queued.
    quick::Session running(store); assert(running.load());
    assert(running.restore(0, 0, 0)); assert(running.start(0));
    for (uint32_t now = 0; now <= minutes * 60000u; ++now) {
      assert(running.tick(now));
      if (running.due(now)) {
        coop::Record r{}; r.sample = now / 2000;
        quick::encode(r, running.data(), now);
        assert(queue.push(r, false)); running.committed(now);
      }
    }
    assert(running.data().phase == quick::COMPLETED);
    assert(running.data().saved == minutes * 30 && queue.pending() == minutes * 30);
    size_t bytes = 0;
    for (const auto &file : LittleFS.state.files)
      if (file.first.find("/quicktest/queue/") == 0) bytes += file.second.size();
    assert(bytes == minutes * 30 * 128);
    for (const auto &file : oldFiles) assert(LittleFS.state.files.at(file.first) == file.second);
    quick::Session reboot(store); assert(reboot.load());
    assert(reboot.restore(queue.pending(), queue.pending(), (minutes * 30 - 1) * 2000));
    assert(!reboot.start(0) && !reboot.due(0)); // Campus reboot cannot restart field test.
    assert(reboot.data().calibration.baselineMv == cal.baselineMv);
    assert(!reboot.arm(minutes, id, cal, true, queue.pending()));
    // A missing acknowledgement leaves all pending records available; acknowledged prefix only.
    coop::Record batch[20]; size_t count = 0;
    assert(queue.batch(batch, 20, count) && count == 20);
    assert(quick::elapsed(batch[0]) == 0 && quick::elapsed(batch[19]) == 38000);
    assert(queue.acknowledge(batch[19].sequence));
    coop::Queue recovered(fs); assert(recovered.recover());
    assert(recovered.pending() == minutes * 30 - 20);
  }
  MemoryStore store; quick::Session test(store); assert(test.load());
  assert(test.arm(30, id, cal, true, 0)); assert(test.start(UINT32_MAX - 1000));
  test.committed(UINT32_MAX - 1000);
  assert(test.due(999)); // millis rollover.
  test.committed(999);
  quick::Session interrupted(store); assert(interrupted.load());
  assert(interrupted.restore(2, 2, 2000));
  assert(interrupted.data().phase == quick::INTERRUPTED && interrupted.data().saved == 2);
  assert(interrupted.closed() && !interrupted.start(0));
  assert(interrupted.arm(15, id, cal, true, 0)); assert(interrupted.start(10));
  assert(interrupted.stop(123010)); assert(interrupted.data().elapsedMs == 123000);
  assert(interrupted.data().phase == quick::STOPPED && !interrupted.due(124000));
  quick::HoldButton button;
  assert(!button.update(0, true) && !button.update(5000, true));
  assert(!button.update(5001, false));
  assert(!button.update(6000, true) && !button.update(7999, true));
  assert(button.update(8000, true) && !button.update(10000, true));
  // Torn newest checkpoint falls back to previous; invalid checkpoints never reset silently.
  store.slots[interrupted.data().generation & 1].crc ^= 1;
  quick::Session fallback(store); assert(fallback.load());
  store.slots[0].crc = store.slots[1].crc = 0;
  quick::Session corrupt(store); assert(!corrupt.load());
  MemoryStore broken; quick::Session unwritable(broken); broken.failWrite = true;
  assert(!unwritable.load());
  MemoryStore checkpoint; quick::Session stoppedWrite(checkpoint); assert(stoppedWrite.load());
  assert(stoppedWrite.arm(15, id, cal, true, 0)); assert(stoppedWrite.start(0));
  checkpoint.failWrite = true; assert(!stoppedWrite.stop(100));
  assert(!stoppedWrite.ready() && !stoppedWrite.tick(900000) && !stoppedWrite.due(2000));
  checkpoint.failWrite = false;
  quick::Session restart(checkpoint); assert(restart.load()); assert(restart.restore(1,1,0));
  assert(restart.data().phase == quick::INTERRUPTED);
  assert(!restart.restore(2,1,0) && !restart.ready());
  LittleFS.state = HostFs{}; FlashStorage fs("/quicktest"); assert(fs.mount());
  coop::Queue full(fs); assert(full.recover());
  for (unsigned n = 0; n < 4096; ++n) { coop::Record r{}; assert(full.push(r, false)); }
  coop::Record extra{}; assert(!full.push(extra, false));
  assert(full.pending() == 4096 && full.dropped() == 0); // Retain every field reading on full queue.
  std::cout << "PASS: 15/30-minute capacity, calibration snapshot, next-boot arm, early stop, rollover, restart recovery, checkpoint faults, upload prefix and legacy queue isolation.\n";
}
