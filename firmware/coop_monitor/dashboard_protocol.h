#pragma once
#include <stdint.h>
#include <stddef.h>
#include <string.h>
#include <math.h>

namespace dashboard {
constexpr uint32_t PROTOCOL_VERSION = 1;
constexpr char FIRMWARE_VERSION[] = "cloudflare-1.0.0";
constexpr char DEFAULT_DEVICE_ID[] = "coop-monitor-01";
constexpr char ENDPOINT[] = "https://coop-monitor-worker.coop-monitor-worker.workers.dev/api/device/exchange";
constexpr size_t READING_CAPACITY = 64, LOG_CAPACITY = 16, BATCH_SIZE = 12;
constexpr size_t COMMAND_CAPACITY = 12, RESPONSE_LIMIT = 16384;
struct Monitoring {
  uint32_t revision = 0;
  bool manual = false;
  uint16_t manualThresholdMv = 0;
  uint8_t consecutive = 3, intervalSec = 2;
};
inline bool validMonitoring(const Monitoring &v) {
  return v.intervalSec >= 2 && v.intervalSec <= 60 && v.consecutive >= 1 && v.consecutive <= 10 &&
    (v.manualThresholdMv == 0 || (v.manualThresholdMv >= 10 && v.manualThresholdMv <= 2399)) &&
    (!v.manual || v.manualThresholdMv >= 10);
}
inline bool sameSettings(const Monitoring &a, const Monitoring &b) {
  return a.manual == b.manual && a.manualThresholdMv == b.manualThresholdMv && a.consecutive == b.consecutive && a.intervalSec == b.intervalSec;
}
inline uint32_t crc32(const void *bytes, size_t size) {
  uint32_t crc = 0xffffffff;
  const auto *p = static_cast<const uint8_t *>(bytes);
  for (size_t n = 0; n < size; ++n) { crc ^= p[n]; for (int bit = 0; bit < 8; ++bit) crc = (crc >> 1) ^ (0xedb88320u & (0u - (crc & 1u))); }
  return ~crc;
}
inline bool validId(const char *v) {
  if (!v || !*v || strnlen(v,65) > 64) return false;
  for (; *v; ++v) if (!((*v >= 'a' && *v <= 'z') || (*v >= 'A' && *v <= 'Z') || (*v >= '0' && *v <= '9') || *v == '-' || *v == '_')) return false;
  return true;
}
inline bool validToken(const char *v) {
  if (!v || strlen(v) != 64) return false;
  for (; *v; ++v) if (!((*v >= 'a' && *v <= 'f') || (*v >= '0' && *v <= '9'))) return false;
  return true;
}
template<typename T, size_t N> struct Ring {
  T values[N]{}; size_t head = 0, count = 0; uint32_t dropped = 0;
  void push(const T &v) { if (count == N) { head = (head + 1) % N; --count; ++dropped; } values[(head + count) % N] = v; ++count; }
  const T &at(size_t n) const { return values[(head + n) % N]; }
  bool remove(uint32_t seq) {
    for (size_t n = 0; n < count; ++n) if (at(n).seq == seq) {
      for (size_t i = n; i + 1 < count; ++i) values[(head + i) % N] = at(i + 1);
      --count; return true;
    } return false;
  }
};
struct Sample {
  uint32_t seq = 0, configRevision = 0, calibrationRevision = 0;
  uint64_t uptimeMs = 0; int64_t sampledUtcMs = 0;
  uint16_t mqRaw = 0, mqMv = 0;
  float mqRatio = NAN, mqThresholdMv = NAN, ahtTemperatureC = NAN, humidityPct = NAN, bmpTemperatureC = NAN, pressureHpa = NAN;
  char status[160] = "UNKNOWN";
};
struct Log {
  uint32_t seq = 0; uint64_t uptimeMs = 0; int64_t sampledUtcMs = 0;
  char level[8] = "info", message[192]{};
};
struct Report {
  Monitoring applied;
  bool configFailed = false, calibrated = false;
  uint32_t warmupRemainingSec = 0, calibrationRevision = 0, calibrationSamples = 0;
  float baselineMv = NAN, calibrationThresholdMv = NAN, sdMv = NAN, temperatureC = NAN, humidityPct = NAN;
  char status[160] = "STARTING", configError[160]{};
};
enum class CommandType : uint8_t { NONE, CAL_SHOW, CAL_EXPORT, CAL_START, CAL_CANCEL, NET_STATUS, NET_RECONNECT, CONFIG_SHOW, RESTART, HELP };
enum class Phase : uint8_t { EMPTY, ACCEPTED, RUNNING, COMPLETED, FAILED, UNCERTAIN };
inline const char *typeName(CommandType t) {
  static const char *names[] = {"", "CAL_SHOW", "CAL_EXPORT", "CAL_START", "CAL_CANCEL", "NET_STATUS", "NET_RECONNECT", "CONFIG_SHOW", "RESTART", "HELP"};
  return static_cast<unsigned>(t) <= 9 ? names[static_cast<unsigned>(t)] : "";
}
inline CommandType commandType(const char *v) {
  if (v) for (unsigned n = 1; n <= 9; ++n) if (!strcmp(v, typeName(static_cast<CommandType>(n)))) return static_cast<CommandType>(n);
  return CommandType::NONE;
}
inline const char *phaseName(Phase p) {
  static const char *names[] = {"", "accepted", "running", "completed", "failed", "uncertain"};
  return static_cast<unsigned>(p) <= 5 ? names[static_cast<unsigned>(p)] : "";
}
inline bool terminal(Phase p) { return p == Phase::COMPLETED || p == Phase::FAILED || p == Phase::UNCERTAIN; }
struct Command {
  char id[65]{}; CommandType type = CommandType::NONE;
  Phase phase = Phase::EMPTY; bool acknowledged = false, dispatched = false;
  int64_t expiresUtcMs = 0; char message[384]{};
};
struct Journal { uint32_t magic = 0x434d4431; Command entries[COMMAND_CAPACITY]{}; uint32_t checksum = 0; };
struct SavedMonitoring { uint32_t magic = 0x43464731; Monitoring value; uint32_t checksum = 0; };
} // namespace dashboard
