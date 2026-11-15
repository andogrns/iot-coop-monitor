#include <Arduino.h>
#include <SPI.h>
#include <SD.h>

// Select the board in Arduino IDE. The Uno uses fixed hardware SPI pins;
// the ESP32-C3 uses the custom pins from coop_monitor.
#if defined(ARDUINO_AVR_UNO)
constexpr int SD_CS_PIN = 10;
constexpr int SD_SCK_PIN = 13;
constexpr int SD_MOSI_PIN = 11;
constexpr int SD_MISO_PIN = 12;
#elif defined(ARDUINO_ARCH_ESP32)
constexpr int SD_CS_PIN = 10;
constexpr int SD_SCK_PIN = 6;
constexpr int SD_MOSI_PIN = 7;
constexpr int SD_MISO_PIN = 1;
constexpr uint32_t SD_SPI_HZ = 4000000;
constexpr uint32_t CHECK_INTERVAL_MS = 5000;
uint32_t lastCheckMs = 0;
#else
#error This test supports the classic Arduino Uno and ESP32-C3 SuperMini only.
#endif

constexpr uint32_t PROBE_SPI_HZ = 400000;
#if defined(ARDUINO_AVR_UNO)
constexpr uint32_t RETRY_SPI_HZ = 1000000;
constexpr uint32_t SLOW_SPI_HZ = 250000;
void printUnoReadError(Sd2Card &card);
bool readUnoSectorSample(Sd2Card &card, uint32_t block, uint8_t *header,
                         uint8_t *tail, uint32_t &checksum);
bool printUnoSectorSample(Sd2Card &card, uint32_t block, uint8_t *header,
                          uint8_t *tail);
void diagnoseUnoSectorReads(Sd2Card &card);
#endif
bool cardWasAvailable = false;

#if defined(ARDUINO_ARCH_ESP32)
const char *cardTypeName(uint8_t type) {
  switch (type) {
    case CARD_MMC: return "MMC";
    case CARD_SD: return "SDSC";
    case CARD_SDHC: return "SDHC/SDXC";
    default: return "unknown";
  }
}
#endif

uint8_t cardSpiResponse() {
  // CMD0 asks the card to enter idle mode. A 0x01 reply confirms that a card
  // answered over the adapter's SPI data path, before any filesystem mount.
  const uint8_t GO_IDLE_STATE[] = {0x40, 0x00, 0x00, 0x00, 0x00, 0x95};
  uint8_t response = 0xFF;

  digitalWrite(SD_CS_PIN, HIGH);
  SPI.beginTransaction(SPISettings(PROBE_SPI_HZ, MSBFIRST, SPI_MODE0));
  for (int i = 0; i < 10; ++i) SPI.transfer(0xFF);  // At least 74 clocks.
  digitalWrite(SD_CS_PIN, LOW);
  for (uint8_t byte : GO_IDLE_STATE) SPI.transfer(byte);
  for (int i = 0; i < 16; ++i) {
    response = SPI.transfer(0xFF);
    if ((response & 0x80) == 0) break;
  }
  digitalWrite(SD_CS_PIN, HIGH);
  SPI.transfer(0xFF);
  SPI.endTransaction();
  return response;
}

void printIndent(uint8_t depth) {
  for (uint8_t i = 0; i < depth; ++i) Serial.print(F("  "));
}

void listDirectory(File &directory, uint8_t depth,
                   uint32_t &fileCount, uint32_t &directoryCount) {
  while (true) {
    File entry = directory.openNextFile();
    if (!entry) break;

    printIndent(depth);
    if (entry.isDirectory()) {
      Serial.print(F("[DIR]  "));
      Serial.println(entry.name());
      ++directoryCount;
      listDirectory(entry, depth + 1, fileCount, directoryCount);
    } else {
      Serial.print(F("[FILE] "));
      Serial.print(entry.name());
      Serial.print(F(" ("));
      Serial.print(entry.size());
      Serial.println(F(" bytes)"));
      ++fileCount;
    }
    entry.close();
  }
}

bool listCardFiles() {
  File root = SD.open("/");
  if (!root || !root.isDirectory()) {
    Serial.println(F("File list: FAIL (cannot open root directory)"));
    root.close();
    return false;
  }

  Serial.println(F("MicroSD contents (/):"));
  uint32_t fileCount = 0;
  uint32_t directoryCount = 0;
  listDirectory(root, 0, fileCount, directoryCount);
  root.close();
  if (fileCount == 0 && directoryCount == 0) {
    Serial.println(F("(empty)"));
  }
  Serial.print(F("Listed "));
  Serial.print(fileCount);
  Serial.print(F(" file(s) and "));
  Serial.print(directoryCount);
  Serial.println(F(" folder(s)."));
  return true;
}

#if defined(ARDUINO_AVR_UNO)
void printUnoReadError(Sd2Card &card) {
  Serial.print(F("error 0x"));
  Serial.print(card.errorCode(), HEX);
  Serial.print(F(", data 0x"));
  Serial.print(card.errorData(), HEX);
  if (card.errorCode() == SD_CARD_ERROR_CMD17) {
    Serial.print(F(" (block-read command failed)"));
  } else if (card.errorCode() == SD_CARD_ERROR_READ_TIMEOUT) {
    Serial.print(F(" (timed out waiting for block data)"));
  } else if (card.errorCode() == SD_CARD_ERROR_READ) {
    Serial.print(F(" (unexpected block-data token)"));
  }
  Serial.println();
}

uint32_t unoLittleEndian32(const uint8_t *bytes) {
  return static_cast<uint32_t>(bytes[0]) |
         (static_cast<uint32_t>(bytes[1]) << 8) |
         (static_cast<uint32_t>(bytes[2]) << 16) |
         (static_cast<uint32_t>(bytes[3]) << 24);
}

bool readUnoSectorSample(Sd2Card &card, uint32_t block, uint8_t *header,
                         uint8_t *tail, uint32_t &checksum) {
  // Stream the entire 512-byte sector through a small buffer to fit Uno RAM.
  // Retain the boot fields and partition table, and hash all bytes. No writes.
  uint8_t chunk[32];
  checksum = 2166136261UL;
  card.partialBlockRead(true);
  for (uint16_t offset = 0; offset < 512; offset += sizeof(chunk)) {
    if (!card.readData(block, offset, sizeof(chunk), chunk)) {
      card.partialBlockRead(false);
      return false;
    }
    for (uint8_t i = 0; i < sizeof(chunk); ++i) {
      const uint16_t index = offset + i;
      checksum = (checksum ^ chunk[i]) * 16777619UL;
      if (index < 32) header[index] = chunk[i];
      if (index >= 446) tail[index - 446] = chunk[i];
    }
  }
  card.partialBlockRead(false);
  return true;
}

bool printUnoSectorSample(Sd2Card &card, uint32_t block, uint8_t *header,
                          uint8_t *tail) {
  Serial.print(F("  Sector "));
  Serial.print(block);
  Serial.print(F(" read twice at 250 kHz: "));
  uint32_t firstChecksum;
  uint32_t secondChecksum;
  if (!readUnoSectorSample(card, block, header, tail, firstChecksum) ||
      !readUnoSectorSample(card, block, header, tail, secondChecksum)) {
    Serial.println(F("FAIL"));
    Serial.print(F("    "));
    printUnoReadError(card);
    return false;
  }
  if (firstChecksum != secondChecksum) {
    Serial.println(F("FAIL (data changed between reads)"));
    return false;
  }
  Serial.print(F("PASS (matching read checksums, 0x"));
  Serial.print(secondChecksum, HEX);
  Serial.println(')');
  Serial.print(F("    Sector signature: "));
  Serial.println(tail[64] == 0x55 && tail[65] == 0xAA ? F("55 AA") : F("INVALID"));
  return true;
}

void printUnoBootFields(const uint8_t *header) {
  Serial.print(F("    Boot fields: bytes/sector="));
  Serial.print(static_cast<uint16_t>(header[11]) |
               (static_cast<uint16_t>(header[12]) << 8));
  Serial.print(F(" sectors/cluster="));
  Serial.print(header[13]);
  Serial.print(F(" reserved sectors="));
  Serial.print(static_cast<uint16_t>(header[14]) |
               (static_cast<uint16_t>(header[15]) << 8));
  Serial.print(F(" FAT copies="));
  Serial.println(header[16]);
}

void diagnoseUnoSectorReads(Sd2Card &card) {
  uint8_t header[32];
  uint8_t tail[66];
  Serial.println(F("Raw sector diagnostics (read-only):"));
  card.setSpiClock(SLOW_SPI_HZ);
  if (!printUnoSectorSample(card, 0, header, tail)) return;
  if (tail[64] != 0x55 || tail[65] != 0xAA) {
    Serial.println(F("    No valid MBR/FAT signature received; compare with PC layout."));
    return;
  }
  if ((header[0] == 0xEB || header[0] == 0xE9) &&
      header[11] == 0 && header[12] == 2 && header[13] != 0 &&
      header[16] != 0) {
    Serial.println(F("    Sector 0 resembles an unpartitioned FAT boot sector."));
    printUnoBootFields(header);
    return;
  }

  uint32_t start[4];
  uint32_t length[4];
  uint8_t type[4];
  for (uint8_t i = 0; i < 4; ++i) {
    const uint8_t *partition = tail + i * 16;
    type[i] = partition[4];
    start[i] = unoLittleEndian32(partition + 8);
    length[i] = unoLittleEndian32(partition + 12);
    Serial.print(F("    Partition "));
    Serial.print(i + 1);
    Serial.print(F(": type=0x"));
    Serial.print(type[i], HEX);
    Serial.print(F(" start="));
    Serial.print(start[i]);
    Serial.print(F(" sectors="));
    Serial.println(length[i]);
    if (type[i] == 0xEE) {
      Serial.println(F("      GPT protective entry; Uno SD.begin expects MBR or plain FAT."));
    }
  }

  const uint32_t cardBlocks = card.cardSize();
  if (cardBlocks == 0) {
    Serial.println(F("    Capacity read failed; partition boot reads skipped."));
    printUnoReadError(card);
    return;
  }
  for (uint8_t i = 0; i < 4; ++i) {
    const bool fatType = type[i] == 0x01 || type[i] == 0x04 ||
                         type[i] == 0x06 || type[i] == 0x0B ||
                         type[i] == 0x0C || type[i] == 0x0E;
    if (!fatType || start[i] == 0 || start[i] >= cardBlocks ||
        length[i] == 0 || length[i] > cardBlocks - start[i]) continue;
    if (i != 0) {
      Serial.println(F("    Note: Uno SD.begin only tries partition 1 or sector 0."));
    }
    if (printUnoSectorSample(card, start[i], header, tail)) {
      printUnoBootFields(header);
    }
  }
}

void diagnoseUnoBeginFailure() {
  // SD.begin() combines card initialization, FAT volume detection, and
  // opening the root directory. Repeat those read-only steps separately.
  Serial.println(F("SD.begin stage diagnostics (retry):"));
  Sd2Card card;
  if (!card.init(SPI_HALF_SPEED, SD_CS_PIN)) {
    Serial.print(F("  Card initialization: FAIL (error 0x"));
    Serial.print(card.errorCode(), HEX);
    Serial.print(F(", data 0x"));
    Serial.print(card.errorData(), HEX);
    Serial.println(')');
    return;
  }
  Serial.println(F("  Card initialization: PASS"));
  card.setSpiClock(SLOW_SPI_HZ);

  SdVolume volume;
  // This sketch only reads, so no dirty write data exists in this cache.
  SdVolume::cacheClear();
  Serial.println(F("  Reading FAT volume at 250 kHz..."));
  if (!volume.init(&card)) {
    Serial.println(F("  FAT volume: FAIL (format, partition, or block read)"));
    Serial.print(F("  Card status after FAT check: "));
    printUnoReadError(card);
    diagnoseUnoSectorReads(card);
    return;
  }
  Serial.println(F("  FAT volume: PASS"));

  SdFile root;
  if (!root.openRoot(&volume)) {
    Serial.println(F("  Root directory: FAIL"));
    return;
  }
  root.close();
  Serial.println(F("  Root directory: PASS (initial failure may be intermittent)"));
}
#endif

void checkCard() {
#if defined(ARDUINO_ARCH_ESP32)
  // Allow the ESP32-C3 to retry after card removal or insertion.
  SD.end();
#endif

  Serial.println(F("Checking MicroSD path..."));
  const uint8_t response = cardSpiResponse();
  Serial.print(F("CMD0 response: 0x"));
  if (response < 0x10) Serial.print('0');
  Serial.println(response, HEX);
  if (response == 0x01) {
    Serial.println(F("Card SPI response: PASS (card replied through adapter)"));
  } else {
    Serial.println(F("Card SPI response: FAIL (check card, adapter, power, wiring)"));
  }

#if defined(ARDUINO_AVR_UNO)
  SdVolume::cacheClear();
  bool mounted = SD.begin(SD_CS_PIN);
  if (!mounted) {
    Serial.println(F("SD.begin at default speed: FAIL"));
    const uint32_t retrySpeeds[] = {RETRY_SPI_HZ, SLOW_SPI_HZ};
    for (uint8_t i = 0; i < 2 && !mounted; ++i) {
      Serial.print(F("Retrying SD.begin at "));
      Serial.print(retrySpeeds[i] / 1000);
      Serial.println(F(" kHz..."));
      SdVolume::cacheClear();
      mounted = SD.begin(retrySpeeds[i], SD_CS_PIN);
      Serial.println(mounted ? F("SD.begin retry: PASS") : F("SD.begin retry: FAIL"));
    }
  } else {
    Serial.println(F("SD.begin at default speed: PASS"));
  }
  if (!mounted) {
    diagnoseUnoBeginFailure();
    cardWasAvailable = false;
    return;
  }
#else
  if (!SD.begin(SD_CS_PIN, SPI, SD_SPI_HZ)) {
    Serial.println(F("Filesystem mount: FAIL"));
    cardWasAvailable = false;
    return;
  }

  const uint8_t type = SD.cardType();
  if (type == CARD_NONE) {
    Serial.println(F("Filesystem mount: FAIL (no card reported)"));
    SD.end();
    cardWasAvailable = false;
    return;
  }

  Serial.println(F("Filesystem mount: PASS"));
  Serial.print(F("Card type: "));
  Serial.println(cardTypeName(type));
  Serial.print(F("Card capacity: "));
  Serial.print(static_cast<uint32_t>(SD.cardSize() / (1024ULL * 1024ULL)));
  Serial.println(F(" MiB"));
#endif
  if (!cardWasAvailable) cardWasAvailable = listCardFiles();
}

void setup() {
  Serial.begin(115200);
  delay(1200);
#if defined(ARDUINO_AVR_UNO)
  Serial.println(F("Arduino Uno MicroSD reader test (read-only)"));
  Serial.println(F("CS=D10 SCK=D13 MOSI=D11 MISO=D12"));
#else
  Serial.println(F("ESP32-C3 MicroSD reader test (read-only)"));
  Serial.println(F("CS=GPIO10 SCK=GPIO6 MOSI=GPIO7 MISO=GPIO1"));
#endif
  Serial.println(F("Adapter alone: cannot be detected (no identification pin)"));
  pinMode(SD_CS_PIN, OUTPUT);
  digitalWrite(SD_CS_PIN, HIGH);
#if defined(ARDUINO_AVR_UNO)
  SPI.begin();  // Uno hardware SPI: D13 SCK, D11 MOSI, D12 MISO.
#else
  SPI.begin(SD_SCK_PIN, SD_MISO_PIN, SD_MOSI_PIN, SD_CS_PIN);
#endif
  checkCard();
#if defined(ARDUINO_ARCH_ESP32)
  lastCheckMs = millis();
#endif
}

void loop() {
#if defined(ARDUINO_ARCH_ESP32)
  if (millis() - lastCheckMs >= CHECK_INTERVAL_MS) {
    lastCheckMs = millis();
    checkCard();
  }
#endif
  // On the Uno, press Reset after changing cards to rerun the one-time test.
}
