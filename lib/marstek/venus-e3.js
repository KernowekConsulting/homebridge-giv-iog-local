'use strict';
// Register facts cross-checked against ViperRNMC e_v3.yaml and marstek-maestro.
// See docs/MARSTEK_MVP.md for provenance and qualification boundaries.
const PROFILE = 'marstek-venus-e3-community-v1';
const BLOCKS = Object.freeze([
  ['deviceName', 31000, 10], ['firmware', 30200, 5],
  ['batteryPower', 30001, 1], ['acPower', 30006, 1],
  ['soc', 34002, 1], ['temperature', 35000, 1], ['acVoltage', 32200, 1]
]);
const CONTROL_BLOCKS = Object.freeze([[42000, 1], [42010, 2], [42020, 2], [43000, 1], [43100, 30]]);
function word(value) {
  if (!Number.isInteger(value) || value < 0 || value > 65535) throw new Error('Invalid Marstek register word');
  return value;
}
function signed(value) { value = word(value); return value > 32767 ? value - 65536 : value; }
function text(words) {
  const bytes = Buffer.alloc(words.length * 2);
  words.forEach((value, i) => bytes.writeUInt16BE(word(value), i * 2));
  return bytes.toString('ascii').replace(/\0.*$/s, '').trim();
}
function decode(blocks, observedAtMs = Date.now(), thresholdW = 50) {
  for (const [key, , count] of BLOCKS) {
    if (!Array.isArray(blocks[key]) || blocks[key].length !== count) throw new Error(`Missing Marstek ${key}`);
    blocks[key].forEach(word);
  }
  const deviceName = text(blocks.deviceName);
  if (!/^(?:Venus[ _-]*E(?:[ ._-]*3(?:\.0)?)?|VNSE3-0)$/i.test(deviceName)) throw new Error(`Unexpected Marstek model: ${deviceName || '(empty)'}`);
  const socPercent = blocks.soc[0] / 10;
  const temperatureC = signed(blocks.temperature[0]) / 10;
  const acVoltageV = blocks.acVoltage[0] / 10;
  const batteryChargeSignedW = signed(blocks.batteryPower[0]);
  const acSignedW = signed(blocks.acPower[0]);
  if (socPercent > 100 || temperatureC < -40 || temperatureC > 100 || acVoltageV > 300 || Math.abs(batteryChargeSignedW) > 10000 || Math.abs(acSignedW) > 10000) {
    throw new Error('Marstek telemetry outside profile bounds; check firmware and scaling');
  }
  return Object.freeze({ profile: PROFILE, deviceName, observedAtMs,
    firmware: { ems: blocks.firmware[0], vms: blocks.firmware[2], bms: blocks.firmware[4] },
    socPercent, temperatureC, acVoltageV, batteryChargeSignedW, acSignedW,
    charging: batteryChargeSignedW > thresholdW, discharging: batteryChargeSignedW < -thresholdW,
    chargePowerW: Math.max(0, batteryChargeSignedW), dischargePowerW: Math.max(0, -batteryChargeSignedW),
    // The device's AC power is not a whole-home import/export meter.
    controlSupported: false, hardwareQualified: false });
}
async function readSnapshot(client, { thresholdW = 50, now = Date.now } = {}) {
  const startedAt = now();
  const blocks = {};
  for (const [key, address, count] of BLOCKS) blocks[key] = await client.readHoldingRegisters(address, count);
  return { model: decode(blocks, startedAt, thresholdW), raw: blocks };
}
function normaliseDevices(input) {
  if (input === undefined) return [];
  if (!Array.isArray(input) || input.length > 4) throw new Error('Marstek devices must be an array of at most four batteries');
  if (input.some(device => !device || typeof device !== 'object' || Array.isArray(device) || (device.enabled !== undefined && typeof device.enabled !== 'boolean'))) throw new Error('Invalid Marstek device entry');
  const ids = new Set(); const endpoints = new Set();
  return input.filter(device => device && device.enabled !== false).map(device => {
    const id = typeof device.id === 'string' ? device.id.trim() : '';
    const host = typeof device.host === 'string' ? device.host.trim() : '';
    if (!/^[A-Za-z0-9_-]{1,48}$/.test(id) || !host || /\s|[/:]/.test(host)) throw new Error('Marstek needs a unique battery ID and a host name or IPv4 address');
    const number = (key, fallback, min, max) => {
      const value = device[key] === undefined ? fallback : device[key];
      if (!Number.isInteger(value) || value < min || value > max) throw new Error(`Invalid Marstek ${key} for ${id}`);
      return value;
    };
    if(device.dischargeLimitW!==undefined&&![800,2500].includes(device.dischargeLimitW))throw new Error('Choose 800 W or 2.5 kW');
    const result = { id, host, name: String(device.name || `Venus ${id}`).trim().slice(0, 48) || `Venus ${id}`,
      port: number('port', 502, 1, 65535), unitId: number('unitId', 1, 1, 247),
      pollIntervalSeconds: number('pollIntervalSeconds', 2, 1, 300),
      timeoutMs: number('timeoutMs', 3000, 100, 10000), staleAfterSeconds: number('staleAfterSeconds', 10, 3, 900),
      thresholdW: number('thresholdW', 50, 0, 1000),
      maxDischargeW: device.dischargeLimitW ?? number('maxDischargeW', 800, 0, 2500), maxChargeW: number('maxChargeW', 2500, 0, 2500),
      higherDischargeLimitConfirmed: device.dischargeLimitW === 2500 || device.higherDischargeLimitConfirmed === true };
    if (result.maxDischargeW > 800 && !result.higherDischargeLimitConfirmed) throw new Error('Discharge above 800 W requires commissioned-limit confirmation');
    const endpoint = `${host.toLowerCase()}:${result.port}:${result.unitId}`;
    if (ids.has(id.toLowerCase()) || endpoints.has(endpoint)) throw new Error('Duplicate Marstek battery ID or endpoint');
    if (result.staleAfterSeconds < result.pollIntervalSeconds) throw new Error('Marstek stale period must cover a poll interval');
    ids.add(id.toLowerCase()); endpoints.add(endpoint);
    return Object.freeze(result);
  });
}
module.exports = { PROFILE, BLOCKS, CONTROL_BLOCKS, decode, readSnapshot, normaliseDevices };
