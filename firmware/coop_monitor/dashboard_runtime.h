#pragma once
#include <Arduino.h>
#include <WiFi.h>
#include <NetworkClientSecure.h>
#include <HTTPClient.h>
#include <Preferences.h>
#include <esp_timer.h>
#include <esp_system.h>
#include <cJSON.h>
#include <sys/time.h>
#include <time.h>
#include "dashboard_protocol.h"
#include "cloudflare_roots.h"
#include "sd_backup.h"
#include <esp_core_dump.h>
#include <esp_netif.h>
#include <esp_sntp.h>
#include <esp_heap_caps.h>
#include <esp_attr.h>

namespace cloud {
using namespace dashboard;
struct NetworkSettings {
  char ssid[33]{}, password[65]{}, url[192]{}, token[65]{}, deviceId[65]{};
  uint32_t revision = 0;
  bool complete() const { return ssid[0] && !strcmp(url, ENDPOINT) && validToken(token) && validId(deviceId); }
};
struct NetworkState { bool wifi = false, paused = false, credentialError = false; uint32_t lastUploadMs = 0; char message[48] = "SETUP NEEDED"; };
struct NetworkDiagnostic {
  int httpStatus = 0, tlsError = 0;
  uint32_t attemptedAtMs = 0, freeHeap = 0, stackFree = 0;
  char stage[64] = "not attempted", detail[128]{};
};
static SemaphoreHandle_t mutex = nullptr;
static TaskHandle_t worker = nullptr;
static NetworkSettings network;
static NetworkState netState;
static NetworkDiagnostic diagnostic;
static Ring<Sample, READING_CAPACITY> readings;
static Ring<Log, LOG_CAPACITY> logs;
static Report report;
static Monitoring monitoring, pendingMonitoring;
static bool configPending = false, commandsBlocked = false;
static Journal journal;
static Command incoming[10]; static size_t incomingCount = 0;
static char bootId[33]{}, reconnectCommand[65]{}, restartCommand[65]{};
static uint32_t logSequence = 0;
// Device health summary sent with each exchange (backend: state.health).
struct Health {
  const char *resetReason = "unknown";
  uint32_t wifiReconnects = 0, uploadFailures = 0;
  bool ahtOk = false, bmpOk = false;
  uint32_t ahtRecovered = 0, ahtFailed = 0, bmpRecovered = 0, bmpFailed = 0;
};
static Health health;
// Survives a software restart, so the next boot can say why it restarted itself.
constexpr uint32_t RESTART_CAUSE_TLS_MEMORY=0x544C534DUL;
RTC_NOINIT_ATTR static uint32_t restartCause;
constexpr int TLS_ALLOC_FAILED=-0x7F00; // MBEDTLS_ERR_SSL_ALLOC_FAILED
constexpr uint32_t MEMORY_RESTART_AFTER_MS=10UL*60UL*1000UL;
static volatile bool memoryRestart=false;
inline bool memoryRestartRequested() { return memoryRestart; }
inline void markMemoryRestart() { restartCause=RESTART_CAUSE_TLS_MEMORY; }
inline const char *resetReasonName(esp_reset_reason_t r) {
  switch (r) {
    case ESP_RST_POWERON: return "power_on"; case ESP_RST_EXT: return "external"; case ESP_RST_SW: return "software";
    case ESP_RST_PANIC: return "panic"; case ESP_RST_INT_WDT: return "interrupt_watchdog"; case ESP_RST_TASK_WDT: return "task_watchdog";
    case ESP_RST_WDT: return "watchdog"; case ESP_RST_DEEPSLEEP: return "deep_sleep"; case ESP_RST_BROWNOUT: return "brownout";
    case ESP_RST_SDIO: return "sdio"; case ESP_RST_USB: return "usb"; case ESP_RST_JTAG: return "jtag"; case ESP_RST_EFUSE: return "efuse";
    case ESP_RST_PWR_GLITCH: return "power_glitch"; case ESP_RST_CPU_LOCKUP: return "cpu_lockup"; default: return "unknown";
  }
}
class Guard {
 public: Guard() { if (mutex) xSemaphoreTake(mutex, portMAX_DELAY); }
  ~Guard() { if (mutex) xSemaphoreGive(mutex); }
};
inline uint64_t uptimeMs() { return static_cast<uint64_t>(esp_timer_get_time()) / 1000; }
inline int64_t utcMs() { timeval t{}; gettimeofday(&t, nullptr); return t.tv_sec >= 1704067200 ? static_cast<int64_t>(t.tv_sec) * 1000 + t.tv_usec / 1000 : 0; }
inline void isoTime(int64_t ms, char *out, size_t size) {
  if (!ms) { *out = 0; return; } time_t seconds = ms / 1000; tm value{}; gmtime_r(&seconds, &value);
  char prefix[24]; strftime(prefix, sizeof(prefix), "%Y-%m-%dT%H:%M:%S", &value);
  snprintf(out, size, "%s.%03uZ", prefix, static_cast<unsigned>(ms % 1000));
}
inline int64_t parseUtc(const char *v) {
  if (!v || strlen(v) != 24) return 0;
  int year, month, day, hour, minute, second, millisPart; char extra;
  if (sscanf(v, "%4d-%2d-%2dT%2d:%2d:%2d.%3dZ%c", &year,&month,&day,&hour,&minute,&second,&millisPart,&extra) != 7 || year < 2024 || month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59 || second > 59) return 0;
  tm date{}; date.tm_year=year-1900; date.tm_mon=month-1; date.tm_mday=day; date.tm_hour=hour; date.tm_min=minute; date.tm_sec=second;
  return static_cast<int64_t>(mktime(&date)) * 1000 + millisPart; // Device timezone is UTC (configTime offset 0).
}
inline bool integerJson(cJSON *v, double min, double max) { return cJSON_IsNumber(v) && isfinite(v->valuedouble) && floor(v->valuedouble) == v->valuedouble && v->valuedouble >= min && v->valuedouble <= max; }
inline cJSON *field(cJSON *v, const char *key) { return cJSON_GetObjectItemCaseSensitive(v, key); }
inline const char *stringField(cJSON *v, const char *key) { cJSON *p=field(v,key); return cJSON_IsString(p) ? p->valuestring : nullptr; }
inline void logLocked(const char *level, const char *message) {
  Log entry; entry.seq=++logSequence; entry.uptimeMs=uptimeMs(); entry.sampledUtcMs=utcMs();
  snprintf(entry.level,sizeof(entry.level),"%s",level); snprintf(entry.message,sizeof(entry.message),"%s",message); logs.push(entry);
  sdbackup::event(entry.level,entry.message,entry.uptimeMs,entry.sampledUtcMs);
}
inline void log(const char *level, const char *message) { if (!mutex) return; Guard lock; logLocked(level,message); }
inline void message(const char *text, bool wifi) { Guard lock; netState.wifi=wifi; if(strcmp(netState.message,text)) { snprintf(netState.message,sizeof(netState.message),"%s",text); logLocked("info",text); } }
inline void exchangeStage(const char *stage) { Guard lock; snprintf(diagnostic.stage,sizeof(diagnostic.stage),"%s",stage); }
inline bool saveJournalLocked() {
  journal.checksum=crc32(&journal,offsetof(Journal,checksum));
  Preferences prefs; if (!prefs.begin("coopcmd",false)) { commandsBlocked=true; return false; }
  bool ok=prefs.putBytes("journal",&journal,sizeof(journal))==sizeof(journal); prefs.end();
  if(!ok) commandsBlocked=true; return ok;
}
inline int findCommandLocked(const char *id) { for(size_t n=0;n<COMMAND_CAPACITY;++n) if(journal.entries[n].phase!=Phase::EMPTY && !strcmp(journal.entries[n].id,id)) return n; return -1; }
inline void updateCommandLocked(const char *id, Phase phase, const char *text) {
  int n=findCommandLocked(id); if(n<0 || terminal(journal.entries[n].phase)) return;
  auto &c=journal.entries[n]; c.phase=phase; c.acknowledged=false; snprintf(c.message,sizeof(c.message),"%s",text);
  if(!saveJournalLocked()) logLocked("error","Command journal write failed; remote execution blocked");
}
inline void commandResult(const char *id, Phase phase, const char *text) { Guard lock; updateCommandLocked(id,phase,text); }
inline void finishCalibrationCommand(bool ok, const char *text) {
  Guard lock; for(size_t n=0;n<COMMAND_CAPACITY;++n) { auto &c=journal.entries[n]; if(c.type==CommandType::CAL_START && c.phase==Phase::RUNNING && c.dispatched) updateCommandLocked(c.id,ok?Phase::COMPLETED:Phase::FAILED,text); }
}
inline Monitoring config() { Guard lock; return monitoring; }
inline bool applyPendingConfig() {
  Guard lock; if(!configPending) return false; configPending=false;
  const Monitoring next=pendingMonitoring;
  if(next.revision < monitoring.revision || (next.revision==monitoring.revision && !sameSettings(next,monitoring))) { report.configFailed=true; snprintf(report.configError,sizeof(report.configError),"Revision rollback or reuse refused"); return false; }
  if(next.revision==monitoring.revision) { report.configFailed=false; report.configError[0]=0; return false; }
  SavedMonitoring saved{}; saved.value=next; saved.checksum=crc32(&saved,offsetof(SavedMonitoring,checksum));
  Preferences prefs; bool ok=prefs.begin("coopcfg",false); if(ok) { ok=prefs.putBytes("monitor",&saved,sizeof(saved))==sizeof(saved); prefs.end(); }
  if(!ok) { report.configFailed=true; snprintf(report.configError,sizeof(report.configError),"Monitoring settings could not be saved to NVS"); return false; }
  monitoring=next; report.applied=next; report.configFailed=false; report.configError[0]=0; logLocked("info","Monitoring configuration applied"); return true;
}
inline void publish(const Sample &sample, const Report &state) {
  if(!mutex) return; Guard lock;
  const bool changed=strcmp(report.status,state.status)!=0;
  bool failed=report.configFailed; char error[160]; snprintf(error,sizeof(error),"%s",report.configError);
  report=state; report.applied=monitoring; report.configFailed=failed; snprintf(report.configError,sizeof(report.configError),"%s",error);
  readings.push(sample); sdbackup::reading(sample); if(changed) logLocked(strstr(sample.status,"GAS_WARNING")?"warn":"info",sample.status);
}
inline void setReconnect(const char *id=nullptr) { Guard lock; ++network.revision; netState.credentialError=false; if(id) snprintf(reconnectCommand,sizeof(reconnectCommand),"%s",id); }
inline bool nextCommand(Command &action) {
  if(!mutex) return false; Guard lock; if(commandsBlocked) return false;
  for(size_t n=0;n<COMMAND_CAPACITY;++n) {
    auto &c=journal.entries[n];
    if(c.phase==Phase::ACCEPTED && !c.dispatched && utcMs()>=c.expiresUtcMs) { updateCommandLocked(c.id,Phase::FAILED,"Expired before execution; no action performed"); continue; }
    if(c.phase==Phase::ACCEPTED && c.acknowledged && !c.dispatched) {
      if(!utcMs()) continue;
      c.phase=Phase::RUNNING; c.acknowledged=false; c.dispatched=true; snprintf(c.message,sizeof(c.message),"Execution started");
      if(!saveJournalLocked()) return false; action=c; return true;
    }
  }
  while(incomingCount) {
    Command c=incoming[0]; for(size_t i=1;i<incomingCount;++i) incoming[i-1]=incoming[i]; --incomingCount;
    if(findCommandLocked(c.id)>=0) continue;
    int slot=-1; for(size_t n=0;n<COMMAND_CAPACITY;++n) if(journal.entries[n].phase==Phase::EMPTY || (terminal(journal.entries[n].phase)&&journal.entries[n].acknowledged)) { slot=n;break; }
    if(slot<0) { logLocked("warn","Command receipt journal full; new command withheld"); return false; }
    if(c.phase==Phase::ACCEPTED || c.phase==Phase::RUNNING) { c.phase=Phase::UNCERTAIN; snprintf(c.message,sizeof(c.message),"Server has a prior execution receipt but this device has no matching journal; not replayed"); }
    else if(!utcMs() || utcMs()>=c.expiresUtcMs) continue;
    else { c.phase=Phase::ACCEPTED; snprintf(c.message,sizeof(c.message),"Durably accepted; awaiting server receipt before execution"); }
    c.acknowledged=false; c.dispatched=false; journal.entries[slot]=c;
    if(!saveJournalLocked()) return false;
  } return false;
}
inline void requestRestart(const char *id) { Guard lock; snprintf(restartCommand,sizeof(restartCommand),"%s",id); }
inline bool restartReady() { Guard lock; int n=findCommandLocked(restartCommand); return n>=0 && journal.entries[n].phase==Phase::RUNNING && journal.entries[n].acknowledged && !commandsBlocked; }
inline void addNumber(cJSON *o,const char *key,double v) { if(isfinite(v)) cJSON_AddNumberToObject(o,key,v); else cJSON_AddNullToObject(o,key); }
inline void addTime(cJSON *o,const char *key,int64_t ms) { if(ms) { char t[32]; isoTime(ms,t,sizeof(t)); cJSON_AddStringToObject(o,key,t); } else cJSON_AddNullToObject(o,key); }
inline void setSensorHealth(bool ahtOk,uint32_t ahtRecovered,uint32_t ahtFailed,bool bmpOk,uint32_t bmpRecovered,uint32_t bmpFailed) {
  if(!mutex) return; Guard lock; health.ahtOk=ahtOk; health.ahtRecovered=ahtRecovered; health.ahtFailed=ahtFailed;
  health.bmpOk=bmpOk; health.bmpRecovered=bmpRecovered; health.bmpFailed=bmpFailed;
}
struct Batch { Sample samples[BATCH_SIZE]; size_t sampleCount=0; Log messages[6]; size_t logCount=0; Command results[5]; size_t resultCount=0; Report state; uint32_t droppedReadings=0,droppedLogs=0; uint64_t uptime=0; Health health; uint32_t queuePending=0; sdbackup::Status sd; };
inline void batch(Batch &b) {
  b.sd=sdbackup::status();
  Guard lock; b.state=report; b.uptime=uptimeMs(); b.droppedReadings=readings.dropped; b.droppedLogs=logs.dropped; b.health=health; b.queuePending=readings.count;
  if(readings.count) { uint64_t firstMinute=readings.at(0).uptimeMs/60000; for(size_t n=0;n<readings.count && b.sampleCount<BATCH_SIZE;++n) { if(readings.at(n).uptimeMs/60000>firstMinute+2) break; b.samples[b.sampleCount++]=readings.at(n); } }
  for(size_t n=0;n<logs.count && b.logCount<6;++n) b.messages[b.logCount++]=logs.at(n);
  for(size_t n=0;n<COMMAND_CAPACITY && b.resultCount<5;++n) if(journal.entries[n].phase!=Phase::EMPTY && !journal.entries[n].acknowledged) b.results[b.resultCount++]=journal.entries[n];
}
inline char *payload(const NetworkSettings &s, const Batch &b) {
  cJSON *root=cJSON_CreateObject(); if(!root) return nullptr;
  cJSON_AddNumberToObject(root,"protocolVersion",PROTOCOL_VERSION); cJSON_AddStringToObject(root,"deviceId",s.deviceId); cJSON_AddStringToObject(root,"bootId",bootId);
  cJSON *state=cJSON_AddObjectToObject(root,"state");
  if(!state) { cJSON_Delete(root); return nullptr; }
  cJSON_AddNumberToObject(state,"uptimeMs",b.uptime); cJSON_AddStringToObject(state,"firmwareVersion",FIRMWARE_VERSION);
  cJSON_AddNumberToObject(state,"appliedConfigRevision",b.state.applied.revision); cJSON_AddStringToObject(state,"configStatus",b.state.configFailed?"failed":b.state.applied.revision?"applied":"pending");
  cJSON_AddStringToObject(state,"configError",b.state.configError); cJSON_AddStringToObject(state,"status",b.state.status); cJSON_AddBoolToObject(state,"calibrated",b.state.calibrated);
  cJSON_AddNumberToObject(state,"warmupRemainingSec",b.state.warmupRemainingSec); cJSON_AddNumberToObject(state,"droppedReadings",b.droppedReadings); cJSON_AddNumberToObject(state,"droppedLogs",b.droppedLogs);
  if(b.state.calibrated) { auto *cal=cJSON_AddObjectToObject(state,"calibration"); if(!cal) { cJSON_Delete(root);return nullptr; }
    cJSON_AddNumberToObject(cal,"revision",b.state.calibrationRevision); cJSON_AddNumberToObject(cal,"samples",b.state.calibrationSamples); addNumber(cal,"baselineMv",b.state.baselineMv); addNumber(cal,"thresholdMv",b.state.calibrationThresholdMv); addNumber(cal,"sdMv",b.state.sdMv); addNumber(cal,"temperatureC",b.state.temperatureC); addNumber(cal,"humidityPct",b.state.humidityPct); }
  if(auto *h=cJSON_AddObjectToObject(state,"health")) {
    cJSON_AddStringToObject(h,"resetReason",b.health.resetReason);
    if(WiFi.status()==WL_CONNECTED) { const int rssi=WiFi.RSSI(); if(rssi<0&&rssi>=-127) cJSON_AddNumberToObject(h,"rssiDbm",rssi); }
    cJSON_AddNumberToObject(h,"wifiReconnects",b.health.wifiReconnects); cJSON_AddNumberToObject(h,"uploadFailures",b.health.uploadFailures);
    cJSON_AddNumberToObject(h,"queuePending",b.queuePending); cJSON_AddNumberToObject(h,"freeHeap",ESP.getFreeHeap()); cJSON_AddNumberToObject(h,"minFreeHeap",ESP.getMinFreeHeap());
    cJSON_AddNumberToObject(h,"largestFreeBlock",heap_caps_get_largest_free_block(MALLOC_CAP_8BIT));
    if(auto *a=cJSON_AddObjectToObject(h,"aht")) { cJSON_AddBoolToObject(a,"ok",b.health.ahtOk); cJSON_AddNumberToObject(a,"recovered",b.health.ahtRecovered); cJSON_AddNumberToObject(a,"failed",b.health.ahtFailed); }
    if(auto *a=cJSON_AddObjectToObject(h,"bmp")) { cJSON_AddBoolToObject(a,"ok",b.health.bmpOk); cJSON_AddNumberToObject(a,"recovered",b.health.bmpRecovered); cJSON_AddNumberToObject(a,"failed",b.health.bmpFailed); }
    if(auto *d=cJSON_AddObjectToObject(h,"sd")) { cJSON_AddStringToObject(d,"state",sdbackup::stateName(b.sd.state)); cJSON_AddNumberToObject(d,"fileBytes",b.sd.fileBytes);
      cJSON_AddNumberToObject(d,"flushes",b.sd.flushes); cJSON_AddNumberToObject(d,"flushFailures",b.sd.flushFailures); cJSON_AddNumberToObject(d,"verifyFailures",b.sd.verifyFailures);
      cJSON_AddNumberToObject(d,"bufferedBytes",b.sd.bufferedBytes); cJSON_AddNumberToObject(d,"droppedRecords",b.sd.droppedRecords); cJSON_AddNumberToObject(d,"lastFlushAgeSec",b.sd.lastFlushAgeSec); }
  }
  auto *rs=cJSON_AddArrayToObject(root,"readings"), *ls=cJSON_AddArrayToObject(root,"logs"), *cs=cJSON_AddArrayToObject(root,"commandResults");
  if(!rs||!ls||!cs) { cJSON_Delete(root);return nullptr; }
  for(size_t n=0;n<b.sampleCount;++n) { const auto &r=b.samples[n]; auto *o=cJSON_CreateObject(); if(!o) {cJSON_Delete(root);return nullptr;} cJSON_AddItemToArray(rs,o);
    cJSON_AddNumberToObject(o,"seq",r.seq); cJSON_AddNumberToObject(o,"uptimeMs",r.uptimeMs); addTime(o,"sampledAt",r.sampledUtcMs);
    cJSON_AddNumberToObject(o,"mqRaw",r.mqRaw); cJSON_AddNumberToObject(o,"mqMv",r.mqMv); addNumber(o,"mqRatio",r.mqRatio); addNumber(o,"mqThresholdMv",r.mqThresholdMv);
    addNumber(o,"ahtTemperatureC",r.ahtTemperatureC); addNumber(o,"humidityPct",r.humidityPct); addNumber(o,"bmpTemperatureC",r.bmpTemperatureC); addNumber(o,"pressureHpa",r.pressureHpa);
    cJSON_AddStringToObject(o,"status",r.status); cJSON_AddNumberToObject(o,"configRevision",r.configRevision); cJSON_AddNumberToObject(o,"calibrationRevision",r.calibrationRevision); }
  for(size_t n=0;n<b.logCount;++n) { const auto &l=b.messages[n]; auto *o=cJSON_CreateObject(); if(!o) {cJSON_Delete(root);return nullptr;} cJSON_AddItemToArray(ls,o);
    cJSON_AddNumberToObject(o,"seq",l.seq); cJSON_AddNumberToObject(o,"uptimeMs",l.uptimeMs); addTime(o,"sampledAt",l.sampledUtcMs); cJSON_AddStringToObject(o,"level",l.level); cJSON_AddStringToObject(o,"message",l.message); }
  for(size_t n=0;n<b.resultCount;++n) { const auto &c=b.results[n]; auto *o=cJSON_CreateObject(); if(!o) {cJSON_Delete(root);return nullptr;} cJSON_AddItemToArray(cs,o);
    cJSON_AddStringToObject(o,"id",c.id); cJSON_AddStringToObject(o,"status",phaseName(c.phase)); cJSON_AddStringToObject(o,"message",c.message); }
  char *out=cJSON_PrintUnformatted(root); cJSON_Delete(root); return out;
}
class BoundedResponse : public Stream {
 public: String text; bool overflow=false;
  size_t write(uint8_t c) override { return write(&c,1); }
  size_t write(const uint8_t *data,size_t size) override { if(text.length()+size>RESPONSE_LIMIT) {overflow=true;return 0;} return text.concat(reinterpret_cast<const char *>(data),size)?size:0; }
  int available() override {return 0;} int read() override {return -1;} int peek() override {return -1;} void flush() override {}
};
inline bool parseMonitoring(cJSON *desired,Monitoring &out) {
  auto *rev=field(desired,"revision"), *s=field(desired,"settings"); if(!integerJson(rev,1,UINT32_MAX)||!cJSON_IsObject(s)) return false;
  const char *mode=stringField(s,"mqThresholdMode"); if(!mode || (strcmp(mode,"automatic") && strcmp(mode,"manual"))) return false;
  auto *threshold=field(s,"manualThresholdMv"), *count=field(s,"warningConsecutiveSamples"), *interval=field(s,"samplingIntervalSec");
  if(!(cJSON_IsNull(threshold)||integerJson(threshold,10,2399))||!integerJson(count,1,10)||!integerJson(interval,2,60))return false;
  out.revision=rev->valuedouble;out.manual=!strcmp(mode,"manual");out.manualThresholdMv=cJSON_IsNull(threshold)?0:threshold->valuedouble;out.consecutive=count->valuedouble;out.intervalSec=interval->valuedouble;return validMonitoring(out);
}
inline bool sampleWasSent(const Batch &b,uint32_t seq,bool isLog) { if(isLog) {for(size_t n=0;n<b.logCount;++n)if(b.messages[n].seq==seq)return true;} else {for(size_t n=0;n<b.sampleCount;++n)if(b.samples[n].seq==seq)return true;}return false; }
inline void retireIds(cJSON *array,const Batch &b,bool isLog,bool rejected) {
  cJSON *v; cJSON_ArrayForEach(v,array) { const char *boot=stringField(v,"bootId");auto *seq=field(v,"seq");
    if(!boot || strcmp(boot,bootId) || !integerJson(seq,0,UINT32_MAX) || !sampleWasSent(b,seq->valuedouble,isLog))continue;
    if(isLog) {if(logs.remove(seq->valuedouble)&&rejected)++logs.dropped;} else {if(readings.remove(seq->valuedouble)&&rejected)++readings.dropped;}
  }
}
inline bool acceptResponse(cJSON *root,const NetworkSettings &s,const Batch &b,uint32_t &delayMs) {
  if(!integerJson(field(root,"protocolVersion"),1,1))return false;
  auto *acked=field(root,"acked"),*rejected=field(root,"rejected"),*uploads=field(root,"uploads"),*commands=field(root,"commands");
  if(!cJSON_IsObject(acked)||!cJSON_IsObject(rejected)||!cJSON_IsObject(uploads)||!cJSON_IsBool(field(uploads,"paused"))||!cJSON_IsArray(commands))return false;
  for(const char *key:{"readings","logs","commandResults"}) if(!cJSON_IsArray(field(acked,key))||!cJSON_IsArray(field(rejected,key)))return false;
  const int64_t server=parseUtc(stringField(root,"serverTime")); if(!server || llabs(server-utcMs())>300000)return false;
  Guard lock;
  if(s.revision!=network.revision) return false; // A USB setting/reconnect changed while HTTPS was in flight.
  retireIds(field(acked,"readings"),b,false,false);retireIds(field(acked,"logs"),b,true,false);retireIds(field(rejected,"readings"),b,false,true);retireIds(field(rejected,"logs"),b,true,true);
  bool journalChanged=false; cJSON *v;
  cJSON_ArrayForEach(v,field(acked,"commandResults")) { if(!cJSON_IsString(v))continue;for(size_t i=0;i<b.resultCount;++i)if(!strcmp(v->valuestring,b.results[i].id)) {int n=findCommandLocked(v->valuestring);if(n>=0 && journal.entries[n].phase==b.results[i].phase && !journal.entries[n].acknowledged) {journal.entries[n].acknowledged=true;journalChanged=true;}} }
  cJSON_ArrayForEach(v,field(rejected,"commandResults")) { const char *id=stringField(v,"id"),*reason=stringField(v,"reason");if(!id||!reason||strcmp(reason,"unknown_expired_or_terminal_command"))continue;int n=findCommandLocked(id);if(n>=0 && terminal(journal.entries[n].phase)&&!journal.entries[n].acknowledged) {journal.entries[n].acknowledged=true;journalChanged=true;} }
  if(journalChanged&&!saveJournalLocked())logLocked("error","Command receipt persistence failed; remote execution blocked");
  Monitoring next; if(parseMonitoring(field(root,"desiredConfig"),next)) {pendingMonitoring=next;configPending=true;} else {report.configFailed=true;snprintf(report.configError,sizeof(report.configError),"Invalid desired settings received");}
  netState.paused=cJSON_IsTrue(field(uploads,"paused")); auto *retry=field(uploads,"retryAfterSec");delayMs=netState.paused?(integerJson(retry,2,300)?static_cast<uint32_t>(retry->valuedouble)*1000:60000):2000;
  cJSON_ArrayForEach(v,commands) {
    const char *id=stringField(v,"id"),*type=stringField(v,"type"),*status=stringField(v,"status");
    CommandType t=commandType(type);if(!validId(id)||t==CommandType::NONE||findCommandLocked(id)>=0||incomingCount>=10||!status)continue;
    bool pending=false;for(size_t n=0;n<incomingCount;++n)if(!strcmp(incoming[n].id,id))pending=true;if(pending)continue;
    const int64_t expires=parseUtc(stringField(v,"expiresAt"));if(!expires)continue;
    if(t==CommandType::CAL_START&&!cJSON_IsTrue(field(field(v,"args"),"referenceConditionsConfirmed")))continue;
    if(strcmp(status,"queued")&&strcmp(status,"accepted")&&strcmp(status,"running"))continue;
    Command c;snprintf(c.id,sizeof(c.id),"%s",id);c.type=t;c.expiresUtcMs=expires;c.phase=!strcmp(status,"accepted")?Phase::ACCEPTED:!strcmp(status,"running")?Phase::RUNNING:Phase::EMPTY;incoming[incomingCount++]=c;
  }
  bool receiptPending=false;for(const auto &c:journal.entries)if(c.phase!=Phase::EMPTY&&!c.acknowledged)receiptPending=true;
  if((incomingCount || receiptPending) && delayMs>2000)delayMs=2000;
  netState.lastUploadMs=millis();return true;
}
inline bool exchange(const NetworkSettings &s,const Batch &b,uint32_t &delayMs,int &status) {
  { Guard lock; diagnostic=NetworkDiagnostic{};diagnostic.attemptedAtMs=millis();diagnostic.freeHeap=ESP.getFreeHeap();diagnostic.stackFree=uxTaskGetStackHighWaterMark(nullptr); }
  exchangeStage("building request");
  char *json=payload(s,b);if(!json) {exchangeStage("request allocation failed");return false;}
  if(strlen(json)>65536) {cJSON_free(json);return false;}
  NetworkClientSecure client; client.setCACert(CLOUDFLARE_ROOTS); client.setHandshakeTimeout(15);
  HTTPClient http;http.setConnectTimeout(15000);http.setTimeout(15000);http.setFollowRedirects(HTTPC_DISABLE_FOLLOW_REDIRECTS);http.setReuse(false);
  bool ok=false;
  exchangeStage("opening HTTPS");
  if(http.begin(client,s.url)) {http.addHeader("Content-Type","application/json");http.addHeader("Authorization",String("Bearer ")+s.token);
    exchangeStage("sending HTTPS request");
    status=http.POST(reinterpret_cast<uint8_t *>(json),strlen(json));cJSON_free(json);json=nullptr;
    {Guard lock;diagnostic.httpStatus=status;diagnostic.tlsError=client.lastError(diagnostic.detail,sizeof(diagnostic.detail));if(status<0)snprintf(diagnostic.stage,sizeof(diagnostic.stage),"%s",HTTPClient::errorToString(status).c_str());else snprintf(diagnostic.stage,sizeof(diagnostic.stage),"HTTP %d; response pending",status);}
    if(status==200 && http.getSize()<=static_cast<int>(RESPONSE_LIMIT)) {BoundedResponse response;int length=http.writeToStream(&response);if(length>=0&&!response.overflow) {cJSON *root=cJSON_Parse(response.text.c_str());if(root) {ok=acceptResponse(root,s,b,delayMs);cJSON_Delete(root);}}}
    if(status==200)exchangeStage(ok?"exchange accepted":"response invalid, oversized or interrupted");
    http.end();
  }
  if(json)cJSON_free(json);return ok;
}
// Some modems answer DHCP but not DNS. Prefer public resolvers and keep the
// DHCP-provided server as the fallback. Reapplied before each exchange because a
// DHCP lease renewal rewrites the main/backup servers.
inline void preferPublicDns() {
  esp_netif_t *n=esp_netif_get_handle_from_ifkey("WIFI_STA_DEF"); if(!n) return;
  const uint32_t primary=ESP_IP4TOADDR(1,1,1,1), backup=ESP_IP4TOADDR(8,8,8,8);
  esp_netif_dns_info_t current{};
  if(esp_netif_get_dns_info(n,ESP_NETIF_DNS_MAIN,&current)!=ESP_OK) return;
  if(current.ip.type==ESP_IPADDR_TYPE_V4 && current.ip.u_addr.ip4.addr==primary) return;
  if(current.ip.type==ESP_IPADDR_TYPE_V4 && current.ip.u_addr.ip4.addr) esp_netif_set_dns_info(n,ESP_NETIF_DNS_FALLBACK,&current);
  esp_netif_dns_info_t d{}; d.ip.type=ESP_IPADDR_TYPE_V4;
  d.ip.u_addr.ip4.addr=primary; esp_netif_set_dns_info(n,ESP_NETIF_DNS_MAIN,&d);
  d.ip.u_addr.ip4.addr=backup; esp_netif_set_dns_info(n,ESP_NETIF_DNS_BACKUP,&d);
}
// Clock sync never overlaps an exchange. Core 3.3.12's NetworkManager::hostByName
// clears the lwIP DNS cache without the TCPIP lock; if SNTP has a DNS lookup in
// flight, that asserts (udp_new_ip_type, "Required to lock TCPIP core") and the
// device reboots. So: sync once after connecting, stop SNTP, let any pending lookup
// expire, then exchange; resync daily the same way.
static volatile bool timeSynced=false;
inline void onTimeSync(struct timeval *) { timeSynced=true; }
constexpr uint32_t SNTP_TIMEOUT_MS=30000, SNTP_SETTLE_MS=20000, SNTP_RESYNC_MS=24UL*3600UL*1000UL;
inline void workerTask(void *) {
  uint32_t activeRevision=UINT32_MAX,lastConnect=0,nextAttempt=0,retryMs=2000,memoryFailSince=0; bool wasConnected=false;
  uint8_t sntpPhase=0; uint32_t sntpPhaseAt=0,lastSyncAt=0; bool needSync=true; // phase 0 idle, 1 syncing, 2 settling
  WiFi.mode(WIFI_STA);sntp_set_time_sync_notification_cb(onTimeSync);
  // ESP32-C3 SuperMini boards transmit poorly at full power (AUTH_EXPIRE, joined but no traffic); 8.5 dBm is the common fix.
  WiFi.setTxPower(WIFI_POWER_8_5dBm);
  for(;;) {
    NetworkSettings s; {Guard lock;s=network;}
    uint32_t now=millis();
    if(activeRevision!=s.revision) {WiFi.disconnect();activeRevision=s.revision;lastConnect=now-30000;nextAttempt=now;retryMs=2000;{Guard lock;netState.credentialError=false;}}
    if(!s.complete())message("SETUP NEEDED",false);
    else if(WiFi.status()!=WL_CONNECTED) {if(wasConnected) {wasConnected=false;Guard lock;++health.wifiReconnects;}message("WIFI OFFLINE",false);if(now-lastConnect>=30000) {WiFi.begin(s.ssid,s.password);WiFi.setTxPower(WIFI_POWER_8_5dBm);lastConnect=now;}}
    else if((wasConnected=true,false)) {}
    else if(sntpPhase==0 && (needSync || (!utcMs() && now-lastSyncAt>=60000))) {
      timeSynced=false;configTime(0,0,"pool.ntp.org","time.google.com");sntpPhase=1;sntpPhaseAt=now;needSync=false;
      message(utcMs()?"SYNCING CLOCK":"WAITING FOR CLOCK",true);
    }
    else if(sntpPhase==1) { if(timeSynced || now-sntpPhaseAt>=SNTP_TIMEOUT_MS) {esp_sntp_stop();sntpPhase=2;sntpPhaseAt=now;lastSyncAt=now;} }
    else if(sntpPhase==2) { if(now-sntpPhaseAt>=(timeSynced?2000:SNTP_SETTLE_MS)) {sntpPhase=0;if(timeSynced)log("info","Clock synchronized; SNTP stopped until the daily resync");} }
    else if(!utcMs())message("WAITING FOR CLOCK",true);
    else {
      bool authError; {Guard lock;authError=netState.credentialError;if(s.revision==network.revision && reconnectCommand[0]) {updateCommandLocked(reconnectCommand,Phase::COMPLETED,"Wi-Fi link re-established");reconnectCommand[0]=0;}}
      if(now-lastSyncAt>=SNTP_RESYNC_MS) needSync=true;
      if(authError)message("CHECK DEVICE TOKEN",true);
      else if(static_cast<int32_t>(now-nextAttempt)>=0) {
        preferPublicDns();Batch b;batch(b);uint32_t delayMs=2000;int status=0;
        if(exchange(s,b,delayMs,status)) {memoryFailSince=0;retryMs=2000;bool paused;{Guard lock;paused=netState.paused;}message(paused?"UPLOADS PAUSED":"CLOUD CONNECTED",true);nextAttempt=millis()+delayMs;}
        else {int tls;{Guard lock;++health.uploadFailures;tls=diagnostic.tlsError;}
          // Heap fragmentation does not heal: if TLS cannot allocate for 10 minutes, ask loop() to save SD data and restart.
          if(tls==TLS_ALLOC_FAILED) {if(!memoryFailSince)memoryFailSince=millis()|1;else if(millis()-memoryFailSince>=MEMORY_RESTART_AFTER_MS&&!memoryRestart){memoryRestart=true;log("error","TLS memory exhausted for 10 minutes; saving SD data and restarting");}}if(status==401) {Guard lock;netState.credentialError=true;}message(status==401?"CHECK DEVICE TOKEN":status==400||status==409?"PROTOCOL ERROR":"CLOUD RETRY",true);retryMs=retryMs<30000?retryMs*2:60000;nextAttempt=millis()+retryMs+(esp_random()%1000);}
      }
    }
    vTaskDelay(pdMS_TO_TICKS(100));
  }
}
inline void begin() {
  mutex=xSemaphoreCreateMutex();if(!mutex) {Serial.println("@NET,ERROR,MUTEX_ALLOCATION");return;}
  uint8_t random[16];esp_fill_random(random,sizeof(random));for(size_t n=0;n<16;++n)snprintf(bootId+2*n,3,"%02x",random[n]);
  snprintf(network.url,sizeof(network.url),"%s",ENDPOINT);snprintf(network.deviceId,sizeof(network.deviceId),"%s",DEFAULT_DEVICE_ID);
  Preferences prefs;
  if(prefs.begin("coopnet",true)) {prefs.getString("ssid","").toCharArray(network.ssid,sizeof(network.ssid));prefs.getString("password","").toCharArray(network.password,sizeof(network.password));prefs.end();}
  if(prefs.begin("coopcloud",true)) {prefs.getString("url",ENDPOINT).toCharArray(network.url,sizeof(network.url));prefs.getString("token","").toCharArray(network.token,sizeof(network.token));prefs.getString("device",DEFAULT_DEVICE_ID).toCharArray(network.deviceId,sizeof(network.deviceId));prefs.end();}
  if(prefs.begin("coopcfg",true)) {
    if(prefs.isKey("monitor")) {SavedMonitoring saved{};if(prefs.getBytesLength("monitor")!=sizeof(saved)||prefs.getBytes("monitor",&saved,sizeof(saved))!=sizeof(saved)||saved.magic!=0x43464731||saved.checksum!=crc32(&saved,offsetof(SavedMonitoring,checksum))||!validMonitoring(saved.value)) {report.configFailed=true;snprintf(report.configError,sizeof(report.configError),"Stored configuration invalid; safe defaults in use");} else monitoring=saved.value;}
    prefs.end();
  }
  bool journalExists=false;
  if(prefs.begin("coopcmd",true)) {journalExists=prefs.isKey("journal");if(journalExists && (prefs.getBytesLength("journal")!=sizeof(journal)||prefs.getBytes("journal",&journal,sizeof(journal))!=sizeof(journal)||journal.magic!=0x434d4431||journal.checksum!=crc32(&journal,offsetof(Journal,checksum))))commandsBlocked=true;prefs.end();}
  if(!commandsBlocked) for(auto &c:journal.entries) if(c.phase!=Phase::EMPTY && (!validId(c.id)||!memchr(c.message,0,sizeof(c.message))||c.type==CommandType::NONE||static_cast<unsigned>(c.type)>COMMAND_TYPE_MAX||static_cast<unsigned>(c.phase)>5))commandsBlocked=true;
  if(commandsBlocked) journal=Journal{}; // Clear only the RAM copy; preserve the corrupt NVS evidence and block execution.
  if(!commandsBlocked) {bool changed=false;for(auto &c:journal.entries)if(c.phase==Phase::ACCEPTED||c.phase==Phase::RUNNING) {bool restarted=c.type==CommandType::RESTART&&c.phase==Phase::RUNNING&&c.acknowledged&&c.dispatched&&esp_reset_reason()==ESP_RST_SW;c.phase=restarted?Phase::COMPLETED:Phase::UNCERTAIN;c.acknowledged=false;snprintf(c.message,sizeof(c.message),"%s",restarted?"Software restart observed on the new boot":"Reboot interrupted prior command; execution not replayed");changed=true;}if(changed)saveJournalLocked();}
  report.applied=monitoring;WiFi.persistent(false);WiFi.setAutoReconnect(true);
  {const esp_reset_reason_t reason=esp_reset_reason();health.resetReason=resetReasonName(reason);
   const bool memoryCause=restartCause==RESTART_CAUSE_TLS_MEMORY;restartCause=0;
   char text[96];snprintf(text,sizeof(text),"BOOT reset=%s fw=%s%s",health.resetReason,FIRMWARE_VERSION,memoryCause&&reason==ESP_RST_SW?" cause=tls_memory":"");log("info",text);Serial.printf("@BOOT,reset=%s\n",health.resetReason);
#if CONFIG_ESP_COREDUMP_ENABLE_TO_FLASH && CONFIG_ESP_COREDUMP_DATA_FORMAT_ELF
   static esp_core_dump_summary_t crash; // ~1 KiB on RISC-V: keep it off the loop task stack
   if(reason==ESP_RST_PANIC && esp_core_dump_image_check()==ESP_OK && esp_core_dump_get_summary(&crash)==ESP_OK) {
     snprintf(text,sizeof(text),"CRASH task=%.16s pc=0x%08lx",crash.exc_task,static_cast<unsigned long>(crash.exc_pc));log("error",text);Serial.printf("@BOOT,%s\n",text);
   }
#endif
  }
  if(commandsBlocked)Serial.println("@NET,ERROR,COMMAND_JOURNAL_REMOTE_EXECUTION_BLOCKED");
  if(xTaskCreate(workerTask,"cloudflare",14336,nullptr,1,&worker)!=pdPASS)snprintf(netState.message,sizeof(netState.message),"NETWORK TASK ERROR");
}
inline bool saveSetting(const char *ns,const char *key,const char *value,char *target,size_t size) {
  if(strlen(value)>=size)return false;Preferences prefs;if(!prefs.begin(ns,false))return false;
  bool ok=*value?prefs.putString(key,value)==strlen(value):(prefs.remove(key)||!prefs.isKey(key));prefs.end();if(ok) {snprintf(target,size,"%s",value);++network.revision;netState.credentialError=false;}return ok;
}
inline void statusText(char *out,size_t size) {Guard lock;snprintf(out,size,"%s; wifi=%s; pending=%u; dropped=%lu; commands=%s",netState.message,netState.wifi?"connected":"offline",static_cast<unsigned>(readings.count),static_cast<unsigned long>(readings.dropped),commandsBlocked?"blocked":"ready");}
inline void oledLine(char *out,size_t size) {Guard lock;snprintf(out,size,"%s",netState.message);}
inline void printConfig() {Monitoring c=config();Serial.printf("@CONFIG,revision=%lu,mode=%s,manual_mv=%u,consecutive=%u,interval_s=%u\n",static_cast<unsigned long>(c.revision),c.manual?"manual":"automatic",c.manualThresholdMv,c.consecutive,c.intervalSec);}
inline bool command(const char *text) {
  if(!mutex)return false;
  if(!strcmp(text,"NET STATUS")) {
    char line[192];statusText(line,sizeof(line));NetworkSettings settings;NetworkDiagnostic diag;NetworkState state;
    {Guard lock;settings=network;diag=diagnostic;state=netState;}
    Serial.printf("@NET,STATUS,%s\n",line);
    Serial.printf("@NET,SETTINGS,ssid=%s,password=%s,endpoint=%s,device=%s,token=%s\n",settings.ssid[0]?"configured":"missing",settings.password[0]?"configured":"open",!strcmp(settings.url,ENDPOINT)?"configured":"invalid",settings.deviceId,settings.token[0]?"configured":"missing");
    Serial.printf("@NET,DIAGNOSTIC,wifi_status=%d,rssi=%d,clock=%s,http=%d,tls=%d,stage=%s,detail=%s,attempt_ms=%lu,success_ms=%lu,heap=%lu,stack_free=%lu\n",WiFi.status(),WiFi.RSSI(),utcMs()?"ready":"unknown",diag.httpStatus,diag.tlsError,diag.stage,diag.detail,static_cast<unsigned long>(diag.attemptedAtMs),static_cast<unsigned long>(state.lastUploadMs),static_cast<unsigned long>(diag.freeHeap),static_cast<unsigned long>(diag.stackFree));Serial.printf("@NET,ADDRESS,ip=%s,gateway=%s,mask=%s,dns0=%s,dns1=%s,dns2=%s\n",WiFi.localIP().toString().c_str(),WiFi.gatewayIP().toString().c_str(),WiFi.subnetMask().toString().c_str(),WiFi.dnsIP(0).toString().c_str(),WiFi.dnsIP(1).toString().c_str(),WiFi.dnsIP(2).toString().c_str());
    return true;
  }
  if(!strcmp(text,"NET RECONNECT")) {setReconnect();Serial.println("@NET,RECONNECTING");return true;}
  if(!strcmp(text,"CONFIG SHOW")) {printConfig();return true;}
  if(!strcmp(text,"WIFI OPEN")) {Guard lock;bool ok=saveSetting("coopnet","password","",network.password,sizeof(network.password));Serial.println(ok?"@NET,SAVED,password":"@NET,ERROR,SAVE_FAILED");return true;}
  struct Setter {const char *prefix,*ns,*key;char *target;size_t size;};
  Setter setters[]={{"WIFI SSID ","coopnet","ssid",network.ssid,sizeof(network.ssid)},{"WIFI PASS ","coopnet","password",network.password,sizeof(network.password)},{"CLOUD URL ","coopcloud","url",network.url,sizeof(network.url)},{"CLOUD ID ","coopcloud","device",network.deviceId,sizeof(network.deviceId)},{"CLOUD TOKEN ","coopcloud","token",network.token,sizeof(network.token)}};
  for(const auto &s:setters)if(!strncmp(text,s.prefix,strlen(s.prefix))) {
    const char *v=text+strlen(s.prefix);bool valid=*v&&strlen(v)<s.size;
    for(const char *p=v;*p;++p)if(static_cast<unsigned char>(*p)<32||*p==127)valid=false;
    if(!strcmp(s.key,"url"))valid=valid&&!strcmp(v,ENDPOINT);
    if(!strcmp(s.key,"device"))valid=valid&&validId(v);
    if(!strcmp(s.key,"token"))valid=valid&&validToken(v);
    if(!strcmp(s.key,"password")) {size_t n=strlen(v);valid=valid&&((n>=8&&n<=63)||n==64);if(n==64)for(const char *p=v;*p;++p)if(!isxdigit(static_cast<unsigned char>(*p)))valid=false;}
    if(!valid) {Serial.println("@NET,ERROR,INVALID_SETTING");return true;}Guard lock;bool ok=saveSetting(s.ns,s.key,v,s.target,s.size);Serial.println(ok?"@NET,SAVED":"@NET,ERROR,SAVE_FAILED");return true;
  }
  if(!strncmp(text,"TEST ",5)||!strncmp(text,"QUEUE ",6)) {Serial.println("@NET,ERROR,LEGACY_STORAGE_COMMAND_DISABLED_NO_FLASH_CHANGES");return true;}
  return false;
}
inline void announce() {
  static char last[48]{};if(!mutex)return;bool changed=false;size_t pending;uint32_t readingDrops,logDrops;
  {Guard lock;changed=strcmp(last,netState.message)!=0;if(changed)snprintf(last,sizeof(last),"%s",netState.message);pending=readings.count;readingDrops=readings.dropped;logDrops=logs.dropped;}
  if(changed)Serial.printf("@NET,%s,pending=%u,dropped=%lu,logs_dropped=%lu\n",last,static_cast<unsigned>(pending),static_cast<unsigned long>(readingDrops),static_cast<unsigned long>(logDrops));
}
} // namespace cloud
