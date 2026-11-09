'use strict';
const { DirectLocalReadOnlyClient } = require('../direct-modbus-client');
const signed = n => n > 32767 ? n - 65536 : n;
// Short read-only banks demonstrated on the owner's GW2412G068. No controls.
const BANKS = [[1600, 20], [1700, 5], [1800, 20]];
async function readGateway({ host, serial, port = 8899, topologyEncoding = 'owner-enum' }, {
  client = new DirectLocalReadOnlyClient({ host, port, expectedSerial: serial, deviceAddress: 17, enableGracefulContinuity: false }), now = Date.now
} = {}) {
  if (!/^(GW|WK)[A-Z0-9]{8}$/.test(serial || '')) throw new Error('Expected Gateway identity required');
  const registers = {}; const times = [];
  for (const [base, count] of BANKS) {
    const started = now(); const response = await client.readInputRegisters(base, count);
    if (response.inverterSerial !== serial || response.deviceAddress !== 17 || response.transparentFunction !== 4 || response.baseRegister !== base || response.values?.length !== count) throw new Error('Gateway response identity/range mismatch');
    times.push(started);
    response.values.forEach((n, i) => { if (!Number.isInteger(n) || n < 0 || n > 65535) throw new Error('Invalid Gateway word'); registers[base + i] = n; });
  }
  const end = now();
  if (end < times[0] || end - times[0] > 2000) throw new Error('Gateway snapshot span too long');
  const raw = registers[1700];
  // Explicit profile choice; never add one to the online-device count.
  if (!['owner-enum', 'literal-count'].includes(topologyEncoding)) throw new Error('Unknown topology encoding');
  const configured = topologyEncoding === 'owner-enum' ? raw + 1 : raw;
  if (configured < 1 || configured > 3 || registers[1701] !== configured) throw new Error('Gateway topology incomplete');
  const units = Array.from({ length: configured }, (_, i) => ({ slot: i + 1, socPercent: registers[1801 + i], acDischargeW: -signed(registers[1816 + i]) }));
  if (units.some(u => u.socPercent > 100)) throw new Error('Invalid AIO SOC');
  return { serial, observedAtMs: times[0], completedAtMs: end, topologyEncoding, rawConfigured: raw,
    onlineCount: registers[1701], gridExportW: signed(registers[1616]), solarW: registers[1617],
    householdLoadW: registers[1618], aioDischargeW: -signed(registers[1702]), units, rawRegisters: registers };
}
async function readGatewayFromConfig(config, dependencies) {
  const options = require('./integration-config').gatewayOptionsFromConfig(config);
  if (!options) throw new Error('Gateway IP and expected serial are not configured');
  return readGateway(options, dependencies);
}
module.exports = { readGateway, readGatewayFromConfig, BANKS };
