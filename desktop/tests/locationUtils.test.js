const test = require("node:test");
const assert = require("node:assert/strict");
const { parseWindowsWifi, parseMacWifi, parseIpLocation } = require("../locationUtils");

test("parses connected and disconnected Windows Wi-Fi output", () => {
  assert.deepEqual(parseWindowsWifi("State : connected\r\nSSID : Office\r\nBSSID : aa:bb:cc:dd:ee:ff\r\nSignal : 82%"), { ok: true, bssid: "AA:BB:CC:DD:EE:FF", ssid: "Office", signal: 82 });
  assert.deepEqual(parseWindowsWifi("State : connected\r\nSSID : Office\r\nAP BSSID : c8:84:a1:71:9d:2e\r\nSignal : 100%"), { ok: true, bssid: "C8:84:A1:71:9D:2E", ssid: "Office", signal: 100 });
  assert.deepEqual(parseWindowsWifi("State : disconnected"), { ok: false, error: "wifi_disconnected" });
});

test("parses macOS Wi-Fi and rejects missing BSSID", () => {
  assert.deepEqual(parseMacWifi(" SSID: Office\n BSSID: aa:bb:cc:dd:ee:ff"), { ok: true, bssid: "AA:BB:CC:DD:EE:FF", ssid: "Office", signal: null });
  assert.equal(parseMacWifi("SSID: Office").ok, false);
});

test("normalizes supported IP geolocation provider payloads", () => {
  assert.deepEqual(parseIpLocation({ status: "success", lat: 1, lon: 2 }), { latitude: 1, longitude: 2, accuracy: 5000 });
  assert.deepEqual(parseIpLocation({ latitude: 3, longitude: 4 }), { latitude: 3, longitude: 4, accuracy: 5000 });
  assert.equal(parseIpLocation({ latitude: "3", longitude: 4 }), null);
});
