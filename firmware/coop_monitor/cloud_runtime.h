#pragma once
#include <WiFi.h>
#include <NetworkClientSecure.h>
#include <HTTPClient.h>
#include <Preferences.h>
#include <esp_timer.h>
#include <esp_system.h>
#include <cJSON.h>
#include <sys/time.h>
#include <math.h>
#include <ctype.h>
#include "flash_storage.h"
#include "google_roots.h"
#include "quick_runtime.h"
#include <esp_mac.h>
#include <nvs.h>

namespace cloud {
struct Settings {
  char ssid[33]{};
  char password[65]{};
  char url[192]{};
  char token[65]{};
  uint32_t revision = 0;
  bool complete() const { return ssid[0] && url[0] && token[0]; }
};
struct State {
  bool queueReady = false, configured = false, wifi = false;
  uint32_t pending = 0;
  uint64_t dropped = 0;
  char message[48] = "SETUP NEEDED";
  uint32_t lastUploadMs = 0;
};
static Settings settings;
static State state;
static FlashStorage storage("/quicktest");
static bool uploadRequested = false, uploadBusy = false;
static coop::Queue queue(storage);
static SemaphoreHandle_t mutex = nullptr;
static TaskHandle_t worker = nullptr;
static uint8_t bootId[16];
static char deviceId[24];
static uint64_t monitoringStartedUs;
static uint32_t announcedPending = UINT32_MAX;
static uint64_t announcedDropped = UINT64_MAX;
static char announcedMessage[48]{};

class Guard {
 public:
  Guard() { if (mutex) xSemaphoreTake(mutex, portMAX_DELAY); }
  ~Guard() { if (mutex) xSemaphoreGive(mutex); }
};
inline State snapshot() { Guard lock; return state; }
inline void refreshQueueState() {
  state.queueReady = queue.ready(); state.pending = queue.pending();
  state.dropped = queue.dropped();
}
inline void message(const char *text, bool wifi) {
  Guard lock;
  snprintf(state.message, sizeof(state.message), "%s", text);
  state.wifi = wifi;
  state.configured = settings.complete();
  refreshQueueState();
}
inline bool allowedEndpoint(const char *url) {
  const char *prefix = "https://script.google.com/macros/s/";
  const size_t n = strlen(url), p = strlen(prefix);
  if (n <= p + 5 || n >= sizeof(settings.url) || strncmp(url, prefix, p) ||
      strcmp(url + n - 5, "/exec")) return false;
  for (size_t i = p; i < n - 5; ++i)
    if (!isalnum(static_cast<unsigned char>(url[i])) && url[i] != '-' && url[i] != '_')
      return false;
  return true;
}
inline bool allowedRedirect(const String &url) {
  if (url.length() > 4096 || !url.startsWith("https://script.googleusercontent.com/"))
    return false;
  for (size_t i = 0; i < url.length(); ++i)
    if (url[i] <= 32 || url[i] == '\\') return false;
  return true;
}
inline void identity(const coop::Record &r, char *id) {
  char boot[33];
  for (unsigned i = 0; i < 16; ++i) snprintf(boot + i * 2, 3, "%02x", r.boot[i]);
  snprintf(id, 80, "%s:%s:%llu", deviceId, boot, (unsigned long long)r.sequence);
}
inline void addNumber(cJSON *object, const char *key, double value) {
  if (isfinite(value)) cJSON_AddNumberToObject(object, key, value);
  else cJSON_AddNullToObject(object, key);
}
inline const char *statusName(unsigned bit) {
  static const char *names[] = {"Warming up", "Calibration missing",
    "Calibration stabilizing", "Calibration collecting", "AHT sensor error",
    "BMP sensor error", "OLED error", "MQ ADC high", "Gas warning"};
  return names[bit];
}
inline char *payload(const Settings &config, const coop::Record *records, size_t count, const quick::Metadata &test) {
  cJSON *root = cJSON_CreateObject();
  if (!root) return nullptr;
  cJSON_AddNumberToObject(root, "version", 2);
  cJSON *session = cJSON_AddObjectToObject(root, "session");
  if (!session) { cJSON_Delete(root); return nullptr; }
  char sessionId[33]; quick::idText(test.id, sessionId);
  cJSON_AddStringToObject(session, "id", sessionId);
  cJSON_AddNumberToObject(session, "duration_min", test.durationMs / 60000);
  cJSON_AddStringToObject(session, "outcome", quick::phaseName(test.phase));
  cJSON *cal = cJSON_AddObjectToObject(session, "calibration");
  if (!cal) { cJSON_Delete(root); return nullptr; }
  addNumber(cal, "baseline_mv", test.calibration.baselineMv);
  addNumber(cal, "threshold_mv", test.calibration.thresholdMv);
  addNumber(cal, "sd_mv", test.calibration.sdMv);
  cJSON_AddNumberToObject(cal, "samples", test.calibration.samples);
  addNumber(cal, "temperature_c", test.calibration.temperatureC);
  addNumber(cal, "humidity_pct", test.calibration.humidityPercent);
  cJSON_AddStringToObject(root, "token", config.token);
  cJSON *array = cJSON_AddArrayToObject(root, "records");
  for (size_t i = 0; i < count && array; ++i) {
    const coop::Record &r = records[i];
    cJSON *item = cJSON_CreateObject();
    if (!item) { cJSON_Delete(root); return nullptr; }
    cJSON_AddItemToArray(array, item);
    char id[80]; identity(r, id);
    cJSON_AddStringToObject(item, "id", id);
    cJSON_AddStringToObject(item, "device_id", deviceId);
    char boot[33];
    for (unsigned n = 0; n < 16; ++n) snprintf(boot + n * 2, 3, "%02x", r.boot[n]);
    cJSON_AddStringToObject(item, "boot_id", boot);
    cJSON_AddNumberToObject(item, "elapsed_test_s", quick::elapsed(r) / 1000.0);
    cJSON_AddNumberToObject(item, "sample", r.sample);
    cJSON_AddNumberToObject(item, "uptime_s", r.uptimeMs / 1000.0);
    if (r.sampledUtcMs) cJSON_AddNumberToObject(item, "sampled_utc_ms", r.sampledUtcMs);
    else cJSON_AddNullToObject(item, "sampled_utc_ms");
    cJSON_AddStringToObject(item, "reason", r.reason ? "Status change" : "Periodic");
    cJSON_AddNumberToObject(item, "mq_raw", r.mqRaw);
    cJSON_AddNumberToObject(item, "mq_adc_mv", r.mqAdcMv);
    addNumber(item, "mq_output_v", r.mqModuleV);
    addNumber(item, "mq_ratio", r.mqRatio);
    addNumber(item, "aht_temp_c", r.ahtTemperatureC);
    addNumber(item, "humidity_pct", r.humidityPercent);
    addNumber(item, "bmp_temp_c", r.bmpTemperatureC);
    addNumber(item, "pressure_hpa", r.pressureHpa);
    char flags[192]{};
    for (unsigned bit = 0; bit < 9; ++bit) if (r.status & (1 << bit)) {
      if (flags[0]) strncat(flags, " | ", sizeof(flags) - strlen(flags) - 1);
      strncat(flags, statusName(bit), sizeof(flags) - strlen(flags) - 1);
    }
    cJSON_AddStringToObject(item, "status", flags[0] ? flags : "OK");
    cJSON_AddNumberToObject(item, "dropped_total", r.droppedTotal);
  }
  char *result = array ? cJSON_PrintUnformatted(root) : nullptr;
  cJSON_Delete(root);
  return result;
}
inline bool acknowledged(const String &body, const coop::Record *records, size_t count) {
  if (body.length() > 4096) return false;
  cJSON *root = cJSON_Parse(body.c_str());
  if (!root) return false;
  cJSON *ok = cJSON_GetObjectItemCaseSensitive(root, "ok");
  cJSON *ids = cJSON_GetObjectItemCaseSensitive(root, "acknowledged");
  bool valid = cJSON_IsTrue(ok) && cJSON_IsArray(ids) &&
               cJSON_GetArraySize(ids) == static_cast<int>(count);
  for (size_t i = 0; valid && i < count; ++i) {
    char id[80]; identity(records[i], id);
    cJSON *entry = cJSON_GetArrayItem(ids, i);
    valid = cJSON_IsString(entry) && strcmp(entry->valuestring, id) == 0;
  }
  cJSON_Delete(root);
  return valid;
}
class LimitedBody : public Stream {
 public:
  String text;
  bool overflow = false;
  size_t write(uint8_t byte) override {
    if (text.length() == 4096) { overflow = true; return 0; }
    text += static_cast<char>(byte); return 1;
  }
  size_t write(const uint8_t *bytes, size_t length) override {
    if (length > 4096 - text.length()) { overflow = true; return 0; }
    if (!text.concat(reinterpret_cast<const char *>(bytes), length)) return 0;
    return length;
  }
  int available() override { return 0; }
  int read() override { return -1; }
  int peek() override { return -1; }
};
inline bool response(HTTPClient &http, const coop::Record *records, size_t count) {
  if (http.getSize() > 4096) return false;
  LimitedBody body;
  const int length = http.writeToStream(&body); // Also decodes chunked responses.
  return length >= 0 && !body.overflow && acknowledged(body.text, records, count);
}
inline bool upload(const Settings &config, const coop::Record *records, size_t count,
                   const char *&error, const quick::Metadata &test) {
  for (size_t i = 0; i < count; ++i) if (records[i].reserved[20] != 1 ||
      memcmp(records[i].reserved, test.id, 16)) { error = "SESSION ID MISMATCH"; return false; }
  char *json = payload(config, records, count, test);
  if (!json) { error = "UPLOAD MEMORY ERROR"; return false; }
  NetworkClientSecure client;
  client.setCACert(GOOGLE_ROOTS);
  client.setHandshakeTimeout(10);
  client.setTimeout(10000);
  HTTPClient http;
  http.setConnectTimeout(10000);
  http.setTimeout(10000);
  http.setFollowRedirects(HTTPC_DISABLE_FOLLOW_REDIRECTS);
  const char *headers[] = {"Location"};
  http.collectHeaders(headers, 1);
  bool accepted = false;
  if (http.begin(client, config.url)) {
    http.addHeader("Content-Type", "application/json");
    const int code = http.POST(reinterpret_cast<uint8_t *>(json), strlen(json));
    free(json); json = nullptr;
    if (code == 200) accepted = response(http, records, count);
    else if (code == 302 || code == 303) {
      String location = http.header("Location");
      http.end();
      client.stop();
      // Only retrieve the acknowledgement via GET; never replay the token/body.
      if (allowedRedirect(location) && http.begin(client, location)) {
        if (http.GET() == 200) accepted = response(http, records, count);
      }
    }
    error = code < 0 ? "HTTPS CONNECTION FAILED" : "UPLOAD NOT ACKNOWLEDGED";
    http.end();
  } else error = "HTTPS SETUP FAILED";
  if (json) free(json);
  return accepted;
}
inline void workerTask(void *) {
  uint32_t activeRevision = UINT32_MAX;
  uint32_t lastConnect = 0, nextAttempt = 0, retryMs = 5000;
  bool clockStarted = false;
  for (;;) {
    Settings config; bool requested;
    { Guard lock; config = settings; requested = uploadRequested; }
    if (!requested) {
      if (WiFi.getMode() != WIFI_OFF) { WiFi.disconnect(true); WiFi.mode(WIFI_OFF); }
      { Guard lock; state.wifi = false; }
      vTaskDelay(pdMS_TO_TICKS(250)); continue;
    }
    WiFi.mode(WIFI_STA);
    if (!clockStarted) { configTime(0, 0, "time.google.com", "pool.ntp.org"); clockStarted = true; }
    const uint32_t now = millis();
    if (activeRevision != config.revision) {
      WiFi.disconnect(); activeRevision = config.revision;
      lastConnect = now - 30000; nextAttempt = now; retryMs = 5000;
    }
    if (!config.complete()) message("SETUP NEEDED", false);
    else if (WiFi.status() != WL_CONNECTED) {
      message("WIFI OFFLINE", false);
      if (now - lastConnect >= 30000) {
        WiFi.begin(config.ssid, config.password); lastConnect = now;
      }
    } else if (time(nullptr) < 1704067200) message("WAITING FOR CLOCK", true);
    else if (static_cast<int32_t>(now - nextAttempt) >= 0) {
      coop::Record records[coop::BATCH_SIZE]; size_t count;
      bool ready; quick::Metadata test;
      { Guard lock;
        if (!uploadRequested) continue;
        ready = queue.batch(records, coop::BATCH_SIZE, count);
        test = quick::session.data(); uploadBusy = ready && count; refreshQueueState(); }
      if (!ready) { { Guard lock; uploadRequested = false; } message("FLASH QUEUE ERROR", true); }
      else if (!count) { { Guard lock; uploadRequested = false; } message("UPLOAD COMPLETE", true); }
      else {
        message("UPLOADING", true);
        const char *error = "UPLOAD FAILED";
        if (upload(config, records, count, error, test)) {
          bool saved;
          { Guard lock;
            saved = queue.acknowledge(records[count - 1].sequence);
            if (saved) state.lastUploadMs = millis();
            refreshQueueState();
          }
          if (!saved) { Guard lock; uploadRequested = false; }
          message(saved ? "UPLOAD ACKNOWLEDGED" : "FLASH QUEUE ERROR", true);
          retryMs = 5000;
        } else {
          message(error, WiFi.status() == WL_CONNECTED);
          retryMs = retryMs < 150000 ? retryMs * 2 : 300000;
        }
      }
      { Guard lock; uploadBusy = false; }
      nextAttempt = millis() + retryMs;
    }
    vTaskDelay(pdMS_TO_TICKS(250));
  }
}
inline void begin() {
  mutex = xSemaphoreCreateMutex();
  if (!mutex) { Serial.println("@NET,ERROR,MUTEX_ALLOCATION"); return; }
  WiFi.persistent(false);
  WiFi.mode(WIFI_OFF);
  uint8_t mac[6]; esp_read_mac(mac, ESP_MAC_WIFI_STA);
  snprintf(deviceId, sizeof(deviceId), "coop-%02x%02x%02x%02x%02x%02x",
           mac[0], mac[1], mac[2], mac[3], mac[4], mac[5]);
  esp_fill_random(bootId, sizeof(bootId));
  Preferences prefs;
  if (prefs.begin("coopnet", true)) {
    prefs.getString("ssid", "").toCharArray(settings.ssid, sizeof(settings.ssid));
    prefs.getString("password", "").toCharArray(settings.password, sizeof(settings.password));
    prefs.getString("url", "").toCharArray(settings.url, sizeof(settings.url));
    prefs.getString("token", "").toCharArray(settings.token, sizeof(settings.token));
    prefs.end();
  }
  if (settings.url[0] && !allowedEndpoint(settings.url)) settings.url[0] = '\0';
  if (ESP.getFlashChipSize() != 4 * 1024 * 1024)
    snprintf(state.message, sizeof(state.message), "FLASH SIZE MISMATCH");
  else if (!storage.mount() || !queue.recover())
    snprintf(state.message, sizeof(state.message), "FLASH QUEUE ERROR");
  refreshQueueState();
  state.configured = settings.complete();
  WiFi.setAutoReconnect(true);
  if (state.queueReady) snprintf(state.message, sizeof(state.message), "WAITING FOR TEST UPLOAD");
  if (xTaskCreate(workerTask, "cloud-upload", 14336, nullptr, 1, &worker) != pdPASS)
    snprintf(state.message, sizeof(state.message), "UPLOAD TASK ERROR");
}
inline bool saveSetting(const char *key, const char *value, char *target, size_t capacity) {
  if (strlen(value) >= capacity) return false;
  Preferences prefs;
  if (!prefs.begin("coopnet", false)) return false;
  const bool saved = value[0] ? prefs.putString(key, value) == strlen(value) :
                      (prefs.remove(key) || !prefs.isKey(key));
  prefs.end();
  if (!saved) return false;
  snprintf(target, capacity, "%s", value); ++settings.revision;
  return true;
}
inline bool command(const char *text) {
  if (!mutex) return false;
  if (strcmp(text, "NET STATUS") == 0 || strcmp(text, "QUEUE STATUS") == 0) {
    Guard lock;
    Serial.printf("@NET,STATUS,%s,wifi=%s,pending=%lu,dropped=%llu,queue=%s,device=%s\n",
      state.message, state.wifi ? "connected" : "offline", (unsigned long)state.pending,
      (unsigned long long)state.dropped, state.queueReady ? "ready" : "unavailable", deviceId);
    Serial.printf("@NET,SETTINGS,ssid=%s,password=%s,url=%s,token=%s\n",
      settings.ssid[0] ? "configured" : "missing", settings.password[0] ? "***" : "empty",
      settings.url[0] ? "configured" : "missing", settings.token[0] ? "***" : "missing");
    if (storage.mounted()) Serial.printf("@QUEUE,SPACE,used=%lu,total=%lu,capacity=4096,record_bytes=128\n",
      (unsigned long)LittleFS.usedBytes(), (unsigned long)LittleFS.totalBytes());
    return true;
  }
  if (strcmp(text, "QUEUE INIT EMPTY") == 0) {
    Guard lock;
    if (ESP.getFlashChipSize() != 4 * 1024 * 1024 || storage.mounted()) {
      Serial.println("@QUEUE,ERROR,INIT_REFUSED"); return true;
    }
    const bool ok = storage.initializeEmpty() && queue.recover() && quick::recover(storage, queue);
    refreshQueueState();
    snprintf(state.message, sizeof(state.message), "%s",
      ok ? "WAITING FOR TEST UPLOAD" : "TEST STORAGE ERROR");
    Serial.println(ok ? "@QUEUE,INITIALIZED" : "@QUEUE,ERROR,INIT_FAILED");
    return true;
  }
  if (strcmp(text, "NET RECONNECT") == 0) {
    Guard lock; ++settings.revision; Serial.println("@NET,RECONNECTING"); return true;
  }
  struct Setter { const char *prefix, *key; char *target; size_t capacity; };
  Setter setters[] = {{"WIFI SSID ", "ssid", settings.ssid, sizeof(settings.ssid)},
    {"WIFI PASS ", "password", settings.password, sizeof(settings.password)},
    {"CLOUD URL ", "url", settings.url, sizeof(settings.url)},
    {"CLOUD TOKEN ", "token", settings.token, sizeof(settings.token)}};
  if (strcmp(text, "WIFI OPEN") == 0) {
    Guard lock; const bool ok = saveSetting("password", "", settings.password, sizeof(settings.password));
    Serial.println(ok ? "@NET,SAVED,password" : "@NET,ERROR,SAVE_FAILED"); return true;
  }
  for (const Setter &setter : setters) if (!strncmp(text, setter.prefix, strlen(setter.prefix))) {
    const char *value = text + strlen(setter.prefix);
    if (!value[0] || (strcmp(setter.key, "url") == 0 && !allowedEndpoint(value)) ||
        (strcmp(setter.key, "token") == 0 && strlen(value) != 64)) {
      Serial.println("@NET,ERROR,INVALID_SETTING"); return true;
    }
    if (strcmp(setter.key, "token") == 0) for (const char *c = value; *c; ++c)
      if (!isxdigit(static_cast<unsigned char>(*c))) {
        Serial.println("@NET,ERROR,INVALID_SETTING"); return true;
      }
    if (strcmp(setter.key, "password") == 0) {
      const size_t length = strlen(value);
      bool valid = length >= 8 && length <= 63;
      if (length == 64) {
        valid = true;
        for (const char *c = value; *c; ++c)
          if (!isxdigit(static_cast<unsigned char>(*c))) valid = false;
      }
      if (!valid) { Serial.println("@NET,ERROR,INVALID_SETTING"); return true; }
    }
    Guard lock; const bool ok = saveSetting(setter.key, value, setter.target, setter.capacity);
    Serial.println(ok ? "@NET,SAVED" : "@NET,ERROR,SAVE_FAILED"); return true;
  }
  return false;
}
inline bool calibrationLocked() {
  Guard lock;
  return quick::session.data().phase == quick::ARMED || quick::session.data().phase == quick::RECORDING;
}
inline bool testCommand(const char *text, const quick::CalibrationSnapshot &cal, bool calibrationReady) {
  if (strncmp(text, "TEST ", 5)) return false;
  if (!mutex) { Serial.println("@TEST,ERROR,MUTEX_UNAVAILABLE"); return true; }
  Guard lock;
  if (!strcmp(text, "TEST STATUS")) {
    const quick::Metadata &test = quick::session.data();
    char id[33]; quick::idText(test.id, id);
    Serial.printf("@TEST,STATUS,%s,id=%s,duration_min=%lu,elapsed_s=%lu,saved=%lu,pending=%lu,metadata=%s,upload=%s\n",
      quick::phaseName(test.phase), id, (unsigned long)(test.durationMs / 60000),
      (unsigned long)(quick::session.elapsed(millis()) / 1000), (unsigned long)test.saved,
      (unsigned long)queue.pending(), quick::session.ready() ? "ready" : "error",
      uploadRequested || uploadBusy ? "active" : test.saved && !queue.pending() ? "complete" : "manual");
    if (storage.mounted()) Serial.printf("@TEST,FLASH,chip_bytes=%lu,fs_total=%lu,fs_used=%lu,queue_capacity=4096,record_bytes=128\n",
      (unsigned long)ESP.getFlashChipSize(), (unsigned long)LittleFS.totalBytes(), (unsigned long)LittleFS.usedBytes());
    nvs_stats_t stats{};
    if (nvs_get_stats(nullptr, &stats) == ESP_OK)
      Serial.printf("@TEST,NVS,free_entries=%lu,total_entries=%lu,calibration_bytes=64,session_checkpoint_bytes=256\n",
        (unsigned long)stats.free_entries, (unsigned long)stats.total_entries);
  } else if (!strcmp(text, "TEST ARM 15") || !strcmp(text, "TEST ARM 30")) {
    const unsigned minutes = !strcmp(text, "TEST ARM 15") ? 15 : 30;
    const size_t budget = (minutes * 30 + 63) * sizeof(coop::Record) + 65536;
    if (!calibrationReady || uploadRequested || uploadBusy || !storage.mounted() ||
        LittleFS.totalBytes() - LittleFS.usedBytes() < budget) {
      Serial.println("@TEST,ERROR,ARM_NEEDS_CALIBRATION_FREE_STORAGE_AND_IDLE_UPLOAD"); return true;
    }
    uint8_t id[16]; esp_fill_random(id, sizeof(id));
    const bool ok = quick::session.arm(minutes, id, cal, queue.ready(), queue.pending());
    Serial.println(ok ? "@TEST,ARMED,POWER_OFF_THEN_POWER_ON_AT_SITE" : "@TEST,ERROR,ARM_REFUSED_CHECK_PENDING_AND_METADATA");
  } else if (!strcmp(text, "TEST STOP")) {
    const bool ok = quick::session.stop(millis());
    Serial.println(ok ? "@TEST,STOPPED" : "@TEST,ERROR,NOT_RECORDING_OR_ARMED");
  } else if (!strcmp(text, "TEST UPLOAD CANCEL")) {
    uploadRequested = false;
    Serial.println("@TEST,UPLOAD_CANCELLED,IN_FLIGHT_ACK_MAY_FINISH");
  } else if (!strcmp(text, "TEST UPLOAD")) {
    if (!quick::session.closed() || !queue.ready() || !settings.complete()) {
      Serial.println("@TEST,ERROR,UPLOAD_NEEDS_FINISHED_SESSION_QUEUE_AND_SETTINGS"); return true;
    }
    uploadRequested = queue.pending() != 0;
    ++settings.revision;
    Serial.println(uploadRequested ? "@TEST,UPLOAD_REQUESTED" : "@TEST,UPLOAD_COMPLETE");
  } else Serial.println("@TEST,ERROR,UNKNOWN_COMMAND");
  return true;
}
inline void testTick(uint32_t now, bool buttonDown) {
  if (!mutex) return;
  Guard lock;
  const bool wasRecording = quick::session.data().phase == quick::RECORDING;
  quick::session.tick(now);
  if (quick::button.update(now, buttonDown) && quick::session.data().phase == quick::RECORDING)
    quick::session.stop(now);
  if (wasRecording && quick::session.data().phase != quick::RECORDING)
    Serial.printf("@TEST,%s,saved=%lu\n", quick::phaseName(quick::session.data().phase),
      (unsigned long)quick::session.data().saved);
}
inline void testOledLine(char *line, size_t capacity) {
  Guard lock;
  const quick::Metadata &test = quick::session.data();
  if (!queue.ready() || !quick::session.ready()) snprintf(line, capacity, "TEST STORAGE ERROR");
  else if (test.phase == quick::RECORDING) {
    const uint32_t elapsed = quick::session.elapsed(millis());
    const uint32_t left = elapsed < test.durationMs ? (test.durationMs - elapsed + 999) / 1000 : 0;
    snprintf(line, capacity, "REC %02lu:%02lu %lu", (unsigned long)(left / 60),
      (unsigned long)(left % 60), (unsigned long)test.saved);
  } else if (uploadRequested || uploadBusy) {
    const char *label = "UPLOAD";
    if (!strcmp(state.message, "WIFI OFFLINE")) label = "WIFI OFFLINE";
    else if (!strcmp(state.message, "WAITING FOR CLOCK")) label = "WAIT CLOCK";
    else if (strcmp(state.message, "UPLOADING") && strcmp(state.message, "UPLOAD ACKNOWLEDGED") &&
             strcmp(state.message, "WAITING FOR TEST UPLOAD")) label = "UPLOAD ERROR";
    snprintf(line, capacity, "%s %lu", label, (unsigned long)queue.pending());
  }
  else snprintf(line, capacity, "%s %lu", quick::phaseName(test.phase), (unsigned long)test.saved);
}
inline void announce() {
  if (!mutex) return;
  const State s = snapshot();
  if (strcmp(s.message, announcedMessage) || s.pending != announcedPending ||
      s.dropped != announcedDropped) {
    Serial.printf("@NET,%s,pending=%lu,dropped=%llu\n", s.message,
      (unsigned long)s.pending, (unsigned long long)s.dropped);
    snprintf(announcedMessage, sizeof(announcedMessage), "%s", s.message);
    announcedPending = s.pending;
    announcedDropped = s.dropped;
  }
}
} // namespace cloud
