#pragma once
// MicroSD backup of every reading and device log event.
//
// Card-friendly write strategy (bench-tested in firmware/sd_backup_c3_test):
//  * Records are buffered in RAM (4 KiB) and written every 15 minutes or when
//    the buffer is 3/4 full (about every 3 min at 5 s sampling), not one by one.
//  * Only whole 512-byte sectors are appended; the remainder waits in RAM, so the
//    file stays sector-aligned and no card sector is rewritten for log data.
//  * A new file starts on every boot/remount, so nothing in an older file is
//    rewritten after a power cut.
//  * Each write is read back and byte-compared (reads do not wear the card).
// A power cut loses only what is still in RAM (at most ~15 minutes).
// The SD card is an extra copy; it never replaces the cloud upload path.
#include <Arduino.h>
#include <FS.h>
#include <SD.h>
#include <SPI.h>
#include <time.h>
#include <freertos/FreeRTOS.h>
#include <freertos/semphr.h>
#include "dashboard_protocol.h"

namespace sdbackup {
constexpr int CS_PIN = 10, SCK_PIN = 6, MOSI_PIN = 7, MISO_PIN = 1;
constexpr uint32_t FAST_HZ = 4000000, SLOW_HZ = 400000;
// RAM matters: the TLS handshake to Cloudflare needs a large free heap block.
constexpr size_t SECTOR = 512, BUF_BYTES = 4096, FLUSH_EARLY_BYTES = 3072;
constexpr uint32_t FLUSH_INTERVAL_MS = 15UL * 60UL * 1000UL;
constexpr uint32_t REMOUNT_MIN_MS = 60000, REMOUNT_MAX_MS = 10UL * 60UL * 1000UL;
constexpr char DIR[] = "/coop";
constexpr char HEADER[] =
    "type,utc,uptime_s,seq,mq_raw,mq_adc_mv,mq_ratio,threshold_mv,aht_c,rh_pct,bmp_c,pressure_hpa,config_rev,status_or_message\n";

enum class State : uint8_t { Disabled, Absent, Ok, Error };
inline const char *stateName(State s) {
  switch (s) { case State::Ok: return "ok"; case State::Absent: return "absent"; case State::Error: return "error"; default: return "disabled"; }
}
struct Status {
  State state = State::Absent;
  uint32_t fileBytes = 0, flushes = 0, flushFailures = 0, verifyFailures = 0, bufferedBytes = 0, droppedRecords = 0;
  uint32_t lastFlushAgeSec = 0, mountedHz = 0;
  char path[24] = "";
};

namespace detail {
inline SemaphoreHandle_t mutex = nullptr;
inline char buf[BUF_BYTES];
inline uint8_t verifyBuf[SECTOR];
inline size_t used = 0;
inline bool atLineStart = true;  // buf[0] begins a record
inline Status st;
inline uint32_t lastFlushMs = 0, lastMountAttemptMs = 0, remountMs = REMOUNT_MIN_MS;
inline void (*sink)(const char *level, const char *message) = nullptr;
struct Lock {
  Lock() { if (mutex) xSemaphoreTake(mutex, portMAX_DELAY); }
  ~Lock() { if (mutex) xSemaphoreGive(mutex); }
};
// Report to Serial and (when not holding the SD lock) to the cloud log.
inline void report(const char *level, const char *message) {
  Serial.printf("@SD,%s,%s\n", level, message);
  if (sink) sink(level, message);
}
inline void append(const char *line, size_t len) {
  Lock lock;
  if (st.state == State::Disabled) return;
  if (used + len > BUF_BYTES) { ++st.droppedRecords; return; }
  memcpy(buf + used, line, len);
  used += len;
}
inline void isoUtc(int64_t ms, char *out, size_t size) {
  if (!ms) { *out = 0; return; }
  time_t seconds = ms / 1000; tm value{}; gmtime_r(&seconds, &value);
  strftime(out, size, "%Y-%m-%dT%H:%M:%SZ", &value);
}
inline void number(char *out, size_t size, float v, int decimals) {
  if (isfinite(v)) snprintf(out, size, "%.*f", decimals, v); else *out = 0;
}
// CSV-safe quoted text: no quotes or line breaks inside.
inline void quoted(char *out, size_t size, const char *a, const char *b = nullptr) {
  size_t n = 0;
  if (size < 3) { *out = 0; return; }
  out[n++] = '"';
  for (const char *p : {a, b}) {
    if (!p) continue;
    if (p == b && n + 2 < size - 1) { out[n++] = ':'; out[n++] = ' '; }
    for (; *p && n < size - 2; ++p) out[n++] = (*p == '"' ? '\'' : (*p == '\n' || *p == '\r') ? ' ' : *p);
  }
  out[n++] = '"'; out[n] = 0;
}

inline uint32_t nextFileNumber() {
  uint32_t highest = 0;
  File dir = SD.open(DIR);
  if (!dir) return 1;
  for (File f = dir.openNextFile(); f; f = dir.openNextFile()) {
    const char *name = f.name(), *base = strrchr(name, '/');
    base = base ? base + 1 : name;
    unsigned long n = 0;
    if (sscanf(base, "b%05lu.csv", &n) == 1 && n > highest) highest = n;
    f.close();
  }
  dir.close();
  return highest + 1;
}

// Start a new file. The buffer must begin with a complete record and the header.
inline void startNewFile() {
  const uint32_t number = nextFileNumber();
  Lock lock;
  snprintf(st.path, sizeof(st.path), "%s/b%05lu.csv", DIR, static_cast<unsigned long>(number));
  st.fileBytes = 0;
  if (!atLineStart) {  // drop the tail of a record whose start went to the previous file
    char *nl = static_cast<char *>(memchr(buf, '\n', used));
    const size_t cut = nl ? static_cast<size_t>(nl - buf) + 1 : used;
    memmove(buf, buf + cut, used - cut); used -= cut; atLineStart = true;
  }
  constexpr size_t H = sizeof(HEADER) - 1;
  if (used + H <= BUF_BYTES) { memmove(buf + H, buf, used); memcpy(buf, HEADER, H); used += H; }
}

inline bool mount() {
  lastMountAttemptMs = millis();
  SPI.begin(SCK_PIN, MISO_PIN, MOSI_PIN, CS_PIN);
  for (uint32_t hz : {FAST_HZ, SLOW_HZ}) {
    if (SD.begin(CS_PIN, SPI, hz, "/sd", 2, false) && SD.cardType() != CARD_NONE) {
      if (!SD.exists(DIR)) SD.mkdir(DIR);
      { Lock lock; st.state = State::Ok; st.mountedHz = hz; }
      startNewFile();
      remountMs = REMOUNT_MIN_MS;
      lastFlushMs = millis();
      char text[96];
      snprintf(text, sizeof(text), "SD backup mounted at %lu kHz, %llu MiB card, writing %s",
               static_cast<unsigned long>(hz / 1000), SD.cardSize() >> 20, st.path);
      report("info", text);
      return true;
    }
    SD.end();
  }
  { Lock lock; if (st.state != State::Error) st.state = State::Absent; st.mountedHz = 0; }
  remountMs = remountMs < REMOUNT_MAX_MS / 2 ? remountMs * 2 : REMOUNT_MAX_MS;
  return false;
}

inline void fail(const char *what) {
  { Lock lock; ++st.flushFailures; st.state = State::Error; }
  SD.end();
  lastMountAttemptMs = millis();
  char text[128];
  snprintf(text, sizeof(text), "SD backup write failed (%s); unmounted, readings stay in RAM and remount is retried", what);
  report("error", text);
}

// Append buf[0..n) to the current file, read it back and compare.
// Runs without the lock: other tasks only append beyond `used`, never touch [0, n).
inline bool writeAndVerify(size_t n) {
  char path[24]; uint32_t expected;
  { Lock lock; memcpy(path, st.path, sizeof(path)); expected = st.fileBytes; }
  File f = SD.open(path, FILE_APPEND);
  if (!f) { fail("open"); return false; }
  if (f.size() != expected) { f.close(); fail("unexpected file size"); return false; }
  const size_t wrote = f.write(reinterpret_cast<const uint8_t *>(buf), n);
  f.close();
  if (wrote != n) { fail("short write"); return false; }
  File r = SD.open(path, FILE_READ);
  if (!r || r.size() != expected + n || !r.seek(expected)) { if (r) r.close(); fail("read-back"); return false; }
  bool same = true;
  for (size_t off = 0; off < n && same; off += SECTOR) {
    const size_t len = min(SECTOR, n - off);
    same = r.read(verifyBuf, len) == len && memcmp(verifyBuf, buf + off, len) == 0;
  }
  r.close();
  if (!same) { { Lock lock; ++st.verifyFailures; } fail("read-back mismatch"); return false; }
  Lock lock;
  atLineStart = buf[n - 1] == '\n';
  memmove(buf, buf + n, used - n);
  used -= n;
  st.fileBytes += n; ++st.flushes;
  lastFlushMs = millis();
  return true;
}

inline bool flush(bool partial) {
  size_t n;
  { Lock lock; if (st.state != State::Ok) return false; n = partial ? used : used - used % SECTOR; }
  lastFlushMs = millis();
  return n ? writeAndVerify(n) : true;
}
} // namespace detail

// ---------- public API ----------

// Write everything buffered, including a partial sector (before a planned restart).
inline bool flushAll() { return detail::flush(true); }

inline void setEventSink(void (*sink)(const char *, const char *)) { detail::sink = sink; }

inline void begin() {
  using namespace detail;
  if (!mutex) mutex = xSemaphoreCreateMutex();
  pinMode(CS_PIN, OUTPUT);
  digitalWrite(CS_PIN, HIGH);
  { Lock lock; used = 0; atLineStart = true; st = Status{}; }
  if (!mount()) report("warn", "SD backup: no usable card (FAT32, wiring CS10/SCK6/MOSI7/MISO1); retrying in the background");
}

inline void reading(const dashboard::Sample &s) {
  using namespace detail;
  char utc[24], ratio[16], thr[16], t[16], rh[16], bt[16], hpa[16], status[176], line[320];
  isoUtc(s.sampledUtcMs, utc, sizeof(utc));
  number(ratio, sizeof(ratio), s.mqRatio, 4); number(thr, sizeof(thr), s.mqThresholdMv, 1);
  number(t, sizeof(t), s.ahtTemperatureC, 2); number(rh, sizeof(rh), s.humidityPct, 2);
  number(bt, sizeof(bt), s.bmpTemperatureC, 2); number(hpa, sizeof(hpa), s.pressureHpa, 2);
  quoted(status, sizeof(status), s.status);
  const int len = snprintf(line, sizeof(line), "R,%s,%llu,%lu,%u,%u,%s,%s,%s,%s,%s,%s,%lu,%s\n", utc,
                           static_cast<unsigned long long>(s.uptimeMs / 1000), static_cast<unsigned long>(s.seq),
                           s.mqRaw, s.mqMv, ratio, thr, t, rh, bt, hpa, static_cast<unsigned long>(s.configRevision), status);
  if (len > 0 && static_cast<size_t>(len) < sizeof(line)) append(line, len);
}

inline void event(const char *level, const char *message, uint64_t uptimeMs, int64_t utcMs) {
  using namespace detail;
  char utc[24], text[224], line[300];
  isoUtc(utcMs, utc, sizeof(utc));
  quoted(text, sizeof(text), level, message);
  const int len = snprintf(line, sizeof(line), "E,%s,%llu,,,,,,,,,,,%s\n", utc, static_cast<unsigned long long>(uptimeMs / 1000), text);
  if (len > 0 && static_cast<size_t>(len) < sizeof(line)) append(line, len);
}

// Call from loop(): timed flushes and background remounts.
inline void service() {
  using namespace detail;
  State state; size_t buffered;
  { Lock lock; state = st.state; buffered = used; }
  const uint32_t now = millis();
  if (state == State::Ok) {
    if (buffered >= FLUSH_EARLY_BYTES || now - lastFlushMs >= FLUSH_INTERVAL_MS) flush(false);
  } else if (state != State::Disabled && now - lastMountAttemptMs >= remountMs) {
    mount();
  }
}

inline Status status() {
  using namespace detail;
  Lock lock;
  Status s = st;
  s.bufferedBytes = used;
  s.lastFlushAgeSec = (millis() - lastFlushMs) / 1000;
  return s;
}

// ---------- operator actions, shared by USB Serial and dashboard commands ----------

// One status line; `sep` separates the key=value fields (USB keeps its comma format).
inline void statusText(char *out, size_t size, const char *sep) {
  const Status s = status();
  snprintf(out, size, "state=%s%sfile=%s%sfile_bytes=%lu%sbuffered=%lu%sflushes=%lu%sflush_failures=%lu%sverify_failures=%lu%sdropped=%lu%slast_flush_s=%lu%skhz=%lu",
           stateName(s.state), sep, s.path[0] ? s.path : "-", sep, static_cast<unsigned long>(s.fileBytes), sep,
           static_cast<unsigned long>(s.bufferedBytes), sep, static_cast<unsigned long>(s.flushes), sep,
           static_cast<unsigned long>(s.flushFailures), sep, static_cast<unsigned long>(s.verifyFailures), sep,
           static_cast<unsigned long>(s.droppedRecords), sep, static_cast<unsigned long>(s.lastFlushAgeSec), sep,
           static_cast<unsigned long>(s.mountedHz / 1000));
}

// Write the whole 512-byte sectors now; a partial sector stays in RAM (card-friendly).
inline bool flushSectors() { return detail::flush(false); }

// Final write (including the partial sector), then unmount and pause backup until remount().
inline bool eject(const char *source) {
  using namespace detail;
  const bool ok = flush(true);
  SD.end();
  { Lock lock; st.state = State::Disabled; used = 0; atLineStart = true; }
  char text[112];
  snprintf(text, sizeof(text), "SD backup ejected by %s command; backup paused until SD MOUNT", source);
  report("info", text);
  return ok;
}

enum class MountResult : uint8_t { AlreadyMounted, Mounted, Failed };
inline MountResult remount() {
  using namespace detail;
  { Lock lock; if (st.state == State::Ok) return MountResult::AlreadyMounted; st.state = State::Absent; }
  remountMs = REMOUNT_MIN_MS;
  return mount() ? MountResult::Mounted : MountResult::Failed;
}

// The newest complete lines of this boot's file, as stored on the card (at most size-1 bytes).
// Returns false when nothing has been written to the card yet this boot.
inline bool tailLines(char *out, size_t size, char *path, size_t pathSize) {
  using namespace detail;
  if (!size) return false;
  *out = 0;
  bool ok;
  { Lock lock; ok = st.state == State::Ok && st.fileBytes; snprintf(path, pathSize, "%s", st.path); }
  File r = ok ? SD.open(path, FILE_READ) : File();
  if (!r) return false;
  const uint32_t want = size - 1, start = r.size() > want ? r.size() - want : 0;
  size_t n = 0;
  if (r.seek(start)) n = r.read(reinterpret_cast<uint8_t *>(out), r.size() - start);
  r.close();
  out[n] = 0;
  // Keep whole lines only: drop a cut first line, and a last line cut at the sector boundary.
  char *first = out;
  if (start > 0) { char *nl = strchr(out, '\n'); first = nl ? nl + 1 : out + n; }
  char *last = strrchr(first, '\n');
  if (last) last[1] = 0; else *first = 0;
  if (first != out) memmove(out, first, strlen(first) + 1);
  return true;
}

// Serial commands: SD STATUS, SD TAIL, SD FLUSH, SD EJECT, SD MOUNT.
inline bool command(const char *text) {
  using namespace detail;
  if (strncmp(text, "SD ", 3) != 0) return false;
  if (!strcmp(text, "SD STATUS")) {
    char line[256];
    statusText(line, sizeof(line), ",");
    Serial.printf("@SD,STATUS,%s\n", line);
  } else if (!strcmp(text, "SD TAIL")) {
    char path[24]; bool ok;
    { Lock lock; ok = st.state == State::Ok && st.fileBytes; memcpy(path, st.path, sizeof(path)); }
    File r = ok ? SD.open(path, FILE_READ) : File();
    if (!r) { Serial.println("@SD,TAIL,nothing_written_yet_this_boot (wait for a flush or send SD FLUSH)"); return true; }
    const uint32_t start = r.size() > 1024 ? r.size() - 1024 : 0;
    r.seek(start);
    Serial.printf("@SD,TAIL,%s,last %lu bytes as stored on the card:\n", path, static_cast<unsigned long>(r.size() - start));
    while (r.available()) Serial.write(r.read());
    r.close();
    Serial.println("\n@SD,TAIL,END");
  } else if (!strcmp(text, "SD FLUSH")) {
    Serial.println(flushSectors() ? "@SD,FLUSHED_WHOLE_SECTORS" : "@SD,ERROR,NOT_MOUNTED_OR_FAILED");
  } else if (!strcmp(text, "SD EJECT")) {
    Serial.println(eject("USB") ? "@SD,EJECTED_SAFE_TO_REMOVE,send SD MOUNT to resume" : "@SD,EJECTED_WITHOUT_FINAL_WRITE,send SD MOUNT to resume");
  } else if (!strcmp(text, "SD MOUNT")) {
    const MountResult m = remount();
    Serial.println(m == MountResult::AlreadyMounted ? "@SD,ALREADY_MOUNTED" : m == MountResult::Mounted ? "@SD,MOUNTED" : "@SD,ERROR,MOUNT_FAILED");
  } else Serial.println("@SD,ERROR,USE_SD_STATUS_TAIL_FLUSH_EJECT_MOUNT");
  return true;
}
} // namespace sdbackup
