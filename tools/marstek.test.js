'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { ReadOnlyModbusTcpClient: Client } = require('../lib/marstek/modbus-tcp');
const { normaliseDevices, readSnapshot, decode } = require('../lib/marstek/venus-e3');
const { VenusMonitor } = require('../lib/marstek/monitor');
const { fixture, createSimulator } = require('./marstek-simulator');

async function setup(t, options = {}) {
  const server = createSimulator(options);
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const client = new Client({ host: '127.0.0.1', port: server.address().port, timeoutMs: 150 });
  t.after(async () => { client.close(); server.closeClients(); await new Promise(resolve => server.close(resolve)); });
  return { server, client, port: server.address().port };
}
function fakeClient(map = fixture()) {
  return { async readHoldingRegisters(address, count) {
    return Array.from({ length: count }, (_, i) => map.get(address + i));
  }, close() {} };
}
test('reads and decodes E3 telemetry; all outbound requests are FC03 and use literal addresses', async t => {
  const requests = [];
  const { client } = await setup(t, { onRequest: request => requests.push(Buffer.from(request)) });
  const snapshot = await readSnapshot(client, { now: () => 100 });
  assert.equal(snapshot.model.socPercent, 72.5);
  assert.equal(snapshot.model.chargePowerW, 500);
  assert.equal(snapshot.model.dischargePowerW, 0);
  assert.equal(snapshot.model.temperatureC, 23.5);
  assert.equal(snapshot.model.acVoltageV, 230.1);
  assert.equal(snapshot.model.observedAtMs, 100);
  assert.equal(snapshot.model.hardwareQualified, false);
  assert.equal(snapshot.model.controlSupported, false);
  assert.equal(requests.length, 7);
  assert.ok(requests.every(request => request[7] === 3 && request[6] === 1));
  assert.equal(requests[0].readUInt16BE(8), 31000);
  assert.equal(typeof client.writeHoldingRegisters, 'undefined');
});
test('fragmented TCP replies and concurrent callers are handled serially', async t => {
  let requests = 0;
  const { client } = await setup(t, { onRequest: () => requests++, response(reply, request, socket) {
    socket.write(reply.subarray(0, 5)); setTimeout(() => { if (!socket.destroyed) socket.write(reply.subarray(5)); }, 5); return null;
  } });
  assert.deepEqual(await Promise.all([client.readHoldingRegisters(34002, 1), client.readHoldingRegisters(30001, 1)]), [[725], [500]]);
  assert.equal(requests, 2);
});
for (const [label, mutate] of [
  ['transaction', r => r.writeUInt16BE(65500, 0)], ['unit', r => { r[6] = 8; }],
  ['protocol', r => r.writeUInt16BE(1, 2)], ['function', r => { r[7] = 4; }],
  ['byte count', r => { r[8] = 0; }], ['length', r => r.writeUInt16BE(999, 4)]
]) test(`rejects malformed ${label} and reconnects for a later valid read`, async t => {
  let bad = true;
  const { client } = await setup(t, { response(reply) { if (bad) { mutate(reply); bad = false; } return reply; } });
  await assert.rejects(client.readHoldingRegisters(34002, 1), /Invalid/);
  assert.deepEqual(await client.readHoldingRegisters(34002, 1), [725]);
});
test('timeouts, connection drops and device exceptions are bounded failures', async t => {
  let calls = 0;
  const { client } = await setup(t, { response(reply, request, socket) {
    calls++; if (calls === 1) return null; if (calls === 2) { socket.destroy(); return null; } return reply;
  } });
  await assert.rejects(client.readHoldingRegisters(34002, 1), /timed out/);
  await assert.rejects(client.readHoldingRegisters(34002, 1), /closed/);
  await assert.rejects(client.readHoldingRegisters(999, 1), /exception 2/);
  assert.deepEqual(await client.readHoldingRegisters(34002, 1), [725]);
});
test('closing cancels an in-flight read and rejects queued work', async t => {
  const { client } = await setup(t, { response: () => null });
  const read = client.readHoldingRegisters(34002, 1);
  const queued = client.readHoldingRegisters(34002, 1);
  const checks = [assert.rejects(read, /closed/), assert.rejects(queued, /closed/)];
  setTimeout(() => client.close(), 20);
  await Promise.all(checks);
});
test('negative battery power is discharge; invalid words, model and scales fail closed', async () => {
  const { model, raw } = await readSnapshot(fakeClient(fixture({ power: -650 })));
  assert.equal(model.dischargePowerW, 650); assert.equal(model.charging, false); assert.equal(model.discharging, true);
  assert.throws(() => decode({ ...raw, soc: [1001] }), /bounds/);
  assert.throws(() => decode({ ...raw, batteryPower: [-1] }), /word/);
  assert.equal(decode({ ...raw, temperature: [65535] }).temperatureC, -0.1);
});
test('unknown models and partial samples are rejected without inferring another profile', async () => {
  await assert.rejects(readSnapshot(fakeClient(fixture({ deviceName: 'VenusD' }))), /Unexpected/);
  const { raw } = await readSnapshot(fakeClient());
  assert.throws(() => decode({ ...raw, temperature: [] }), /Missing/);
});
test('configuration is optional, strict, bounded and rejects duplicate devices', () => {
  assert.deepEqual(normaliseDevices(), []);
  const d = { id: 'garage', host: '192.0.2.10' };
  assert.equal(normaliseDevices([d])[0].port, 502);
  assert.throws(() => normaliseDevices([d, { ...d, host: '192.0.2.11' }]), /Duplicate/);
  assert.throws(() => normaliseDevices([d, { ...d, id: 'other' }]), /Duplicate/);
  assert.throws(() => normaliseDevices([{ ...d, unitId: 0 }]), /unitId/);
  assert.throws(() => normaliseDevices([{ ...d, staleAfterSeconds: 1 }]), /stale/);
  assert.throws(() => normaliseDevices([{ ...d, port: '502' }]), /port/);
  assert.deepEqual(normaliseDevices([{ ...d, enabled: false }]), []);
  assert.throws(() => normaliseDevices([null]), /Invalid/);
  assert.throws(() => normaliseDevices([{ ...d, enabled: 'false' }]), /Invalid/);
});
test('brief dropouts preserve observation time, age expires independently, and fresh reads recover', async () => {
  let now = 1000; let fail = false; let reads = 0;
  const config = normaliseDevices([{ id: 'garage', host: 'simulator', staleAfterSeconds: 90 }])[0];
  const monitor = new VenusMonitor(config, { now: () => now, clientFactory() {
    const client = fakeClient(); const read = client.readHoldingRegisters;
    client.readHoldingRegisters = async (...args) => { reads++; if (fail) throw new Error('offline'); return read(...args); };
    return client;
  } });
  await Promise.all([monitor.pollOnce(), monitor.pollOnce()]);
  assert.equal(reads, 7, 'only one in-flight snapshot');
  assert.equal(monitor.state().status, 'online');
  fail = true; now += 30000; await monitor.pollOnce();
  assert.equal(monitor.state().status, 'retrying'); assert.equal(monitor.state().stale, false);
  assert.equal(monitor.state().sample.model.observedAtMs, 1000);
  now += 60000; assert.equal(monitor.state().stale, true);
  fail = false; await monitor.pollOnce(); assert.equal(monitor.state().status, 'online');
  assert.equal(monitor.state().ageMs, 0); monitor.stop();
});
test('stopping mid-poll cannot publish a late success', async () => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const client = fakeClient(); const read = client.readHoldingRegisters;
  client.readHoldingRegisters = async (...args) => { await gate; return read(...args); };
  const monitor = new VenusMonitor(normaliseDevices([{ id: 'g', host: 's' }])[0], { clientFactory: () => client });
  let events = 0; monitor.on('state', () => events++);
  const task = monitor.pollOnce(); monitor.stop(); release(); await task;
  assert.equal(monitor.sample, null); assert.equal(events, 0);
});
