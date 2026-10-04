#pragma once
#include <stdint.h>
// Host stand-in for the Arduino FS API. Tests execute the real FlashStorage
// adapter, but do not emulate LittleFS internals or physical flash guarantees.
#include <map>
#include <vector>
#include <string>
#include <cstring>
#include <cstdio>
#include <cstdlib>
#include <algorithm>
#include <memory>
#include <set>
struct HostFs {
  std::map<std::string, std::vector<uint8_t>> files;
  bool mountable = true, directory = true, failRename = false;
  std::set<std::string> directories;
  unsigned formats = 0;
};
class File {
 public:
  File() = default;
  File(HostFs *fs, const std::string &name, bool directory = false)
      : fs_(fs), name_(name), directory_(directory) {}
  explicit operator bool() const { return fs_ != nullptr; }
  bool isDirectory() const { return directory_; }
  const char *name() const { return name_.c_str(); }
  size_t size() const { return fs_ && !directory_ ? fs_->files.at(name_).size() : 0; }
  int available() const { return static_cast<int>(size() - position_); }
  size_t read(uint8_t *buffer, size_t length) {
    if (!fs_ || directory_) return 0;
    const auto &bytes = fs_->files.at(name_);
    length = std::min(length, bytes.size() - position_);
    std::memcpy(buffer, bytes.data() + position_, length);
    position_ += length;
    return length;
  }
  size_t write(const uint8_t *buffer, size_t length) {
    if (!fs_ || directory_) return 0;
    auto &bytes = fs_->files[name_];
    bytes.resize(std::max(bytes.size(), position_ + length));
    std::memcpy(bytes.data() + position_, buffer, length);
    position_ += length;
    return length;
  }
  void appendPosition() { position_ = size(); }
  void flush() {}
  void close() { fs_ = nullptr; }
  File openNextFile() {
    if (!fs_ || !directory_) return {};
    const std::string prefix = name_ + "/";
    for (const auto &entry : fs_->files) {
      if (entry.first.compare(0, prefix.size(), prefix) == 0 && entry.first > last_) {
        last_ = entry.first; return File(fs_, entry.first);
      }
    }
    return {};
  }
 private:
  HostFs *fs_ = nullptr;
  std::string name_, last_;
  bool directory_ = false;
  size_t position_ = 0;
};
class FakeLittleFS {
 public:
  HostFs state;
  bool begin(bool formatOnFail) {
    if (!state.mountable && formatOnFail) return format();
    return state.mountable;
  }
  bool exists(const char *path) {
    return std::string(path) == "/queue" ? state.directory : state.directories.count(path) || state.files.count(path);
  }
  bool mkdir(const char *path) { if (std::string(path) == "/queue") state.directory = true; else state.directories.insert(path); return true; }
  bool format() {
    ++state.formats; state.files.clear(); state.directories.clear(); state.directory = false;
    state.mountable = true; return true;
  }
  File open(const char *path, const char *mode) {
    if (!state.mountable) return {};
    if (std::string(path) == "/queue")
      return state.directory ? File(&state, path, true) : File{};
    if (state.directories.count(path)) return File(&state, path, true);
    if (std::string(mode) == "w") state.files[path].clear();
    else if (std::string(mode) == "a") state.files[path];
    else if (!state.files.count(path)) return {};
    File file(&state, path);
    if (std::string(mode) == "a") file.appendPosition();
    return file;
  }
  bool rename(const char *from, const char *to) {
    if (state.failRename || !state.files.count(from)) return false;
    state.files[to] = state.files[from]; state.files.erase(from); return true;
  }
  bool remove(const char *path) { return state.files.erase(path) == 1; }
};
static FakeLittleFS LittleFS;
