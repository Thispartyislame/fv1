/*
 * FV-1 EEPROM programmer for FV-1 Studio  (Arduino Uno / Nano / Pro Mini)
 *
 * Programs a 24LC32A (4096-byte I2C EEPROM) from the browser over USB serial (Web Serial, Chrome/Edge).
 *
 * WIRING  (EEPROM out of the pedal, or on a breadboard / SOIC clip adapter)
 *   24LC32A pin 1,2,3 (A0,A1,A2) -> GND      (device address 0x50, what the FV-1 expects)
 *   24LC32A pin 4 (VSS)          -> GND
 *   24LC32A pin 5 (SDA)          -> A4 (SDA)   (+ 4.7k pull-up to VCC)
 *   24LC32A pin 6 (SCL)          -> A5 (SCL)   (+ 4.7k pull-up to VCC)
 *   24LC32A pin 7 (WP)           -> GND        (write enabled)
 *   24LC32A pin 8 (VCC)          -> 3.3 V or 5 V  (24LC32A works 2.5-5.5 V; use the Arduino's logic level)
 *
 * IMPORTANT: Don't program the chip while it is connected to a powered FV-1. The FV-1 is the I2C master and
 * will fight the Arduino. Remove the EEPROM (use a socket) or hold the FV-1 in reset with its supply off.
 *
 * Protocol (115200 8N1):
 *   host '?'                         -> 'FV1PROG1' + ('Y' chip answered | 'N' no chip)
 *   host 'P' addrHi addrLo d0..d15   -> 'K' ok | 'E' error     (16-byte page write, addr 16-aligned)
 *   host 'R' addrHi addrLo 16        -> 16 data bytes + ('K' | 'E')
 */
#include <Wire.h>

const uint8_t EEPROM_ADDR = 0x50;
const uint8_t CHUNK = 16;

bool chipPresent() {
  Wire.beginTransmission(EEPROM_ADDR);
  return Wire.endTransmission() == 0;
}

bool waitReady() {                       // ACK polling after a write (max ~10 ms per datasheet)
  for (uint8_t i = 0; i < 40; i++) {
    if (chipPresent()) return true;
    delay(1);
  }
  return false;
}

int readByteBlocking() {
  unsigned long t = millis();
  while (!Serial.available()) { if (millis() - t > 1000) return -1; }
  return Serial.read();
}

void setup() {
  Serial.begin(115200);
  Wire.begin();
  Wire.setClock(100000);
}

void loop() {
  if (!Serial.available()) return;
  char cmd = Serial.read();

  if (cmd == '?') {
    Serial.print(F("FV1PROG1"));
    Serial.write(chipPresent() ? 'Y' : 'N');
  }
  else if (cmd == 'P') {
    int hi = readByteBlocking(), lo = readByteBlocking();
    uint8_t data[CHUNK];
    bool ok = (hi >= 0 && lo >= 0);
    for (uint8_t i = 0; i < CHUNK && ok; i++) { int b = readByteBlocking(); if (b < 0) ok = false; else data[i] = b; }
    if (ok) {
      uint16_t addr = ((uint16_t)hi << 8) | lo;
      Wire.beginTransmission(EEPROM_ADDR);
      Wire.write((uint8_t)(addr >> 8)); Wire.write((uint8_t)(addr & 0xFF));
      Wire.write(data, CHUNK);
      ok = (Wire.endTransmission() == 0) && waitReady();
    }
    Serial.write(ok ? 'K' : 'E');
  }
  else if (cmd == 'R') {
    int hi = readByteBlocking(), lo = readByteBlocking(), n = readByteBlocking();
    bool ok = (hi >= 0 && lo >= 0 && n > 0 && n <= 32);
    uint8_t buf[32];
    if (ok) {
      uint16_t addr = ((uint16_t)hi << 8) | lo;
      Wire.beginTransmission(EEPROM_ADDR);
      Wire.write((uint8_t)(addr >> 8)); Wire.write((uint8_t)(addr & 0xFF));
      ok = (Wire.endTransmission(false) == 0) && (Wire.requestFrom((int)EEPROM_ADDR, n) == n);
      for (int i = 0; i < n; i++) buf[i] = ok ? Wire.read() : 0xFF;
    } else { n = (n > 0 && n <= 32) ? n : 16; for (int i = 0; i < n; i++) buf[i] = 0xFF; }
    Serial.write(buf, n);
    Serial.write(ok ? 'K' : 'E');
  }
}
