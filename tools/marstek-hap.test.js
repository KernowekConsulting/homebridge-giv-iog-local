'use strict';
const test = require('node:test'); const assert = require('node:assert/strict');
const fs = require('node:fs'); const path = require('node:path'); const os = require('node:os');
const { EventEmitter } = require('node:events');
const hb = require.resolve('homebridge');
let hapEntry; try { hapEntry = require.resolve('@homebridge/hap-nodejs', { paths: [path.dirname(hb)] }); }
catch { hapEntry = require.resolve('hap-nodejs', { paths: [path.dirname(hb)] }); }
const hap = require(hapEntry);
const { MarstekHomebridge, OWNER } = require('../lib/marstek/homebridge');
const { GivHomeModbusPlatform } = require('../index');
const { normaliseDevices, readSnapshot } = require('../lib/marstek/venus-e3');
const { fixture } = require('./marstek-simulator');
class Accessory extends hap.Accessory { constructor(name, uuid) { super(name, uuid); this.context = {}; } }
const log = Object.assign(() => {}, { info() {}, warn() {}, error() {}, debug() {} });
function setup(t, devices = [{ id: 'garage', host: '192.0.2.10', name: 'Garage Venus' }]) {
  const registered = []; const removed = []; const monitors = [];
  const api = { hap, platformAccessory: Accessory,
    registerPlatformAccessories(_p, _a, values) { registered.push(...values); },
    unregisterPlatformAccessories(_p, _a, values) { removed.push(...values); }, updatePlatformAccessories() {} };
  const config = { marstekDevices: devices };
  const manager = new MarstekHomebridge(log, api, config, { monitorFactory(device) {
    const monitor = new EventEmitter(); monitor.config = device;
    monitor.current = { sample: null, stale: true, status: 'starting', lastError: '' };
    monitor.state = () => monitor.current; monitor.start = () => {}; monitor.stop = () => { monitor.stopped = true; };
    monitors.push(monitor); return monitor;
  } });
  t.after(() => manager.stop());
  return { manager, api, registered, removed, monitors, config };
}
async function publish(monitor, power = 500) {
  const registers = fixture({ power });
  const sample = await readSnapshot({ readHoldingRegisters: async (a, n) => Array.from({ length: n }, (_, i) => registers.get(a + i)) });
  monitor.current = { sample, stale: false, status: 'online', lastError: '' };
  monitor.emit('state', monitor.current);
}
test('native HAP publishes battery, activity, temperature and numeric power with no writable controls', async t => {
  const s = setup(t); s.manager.start(); await publish(s.monitors[0]);
  const accessory = s.registered[0]; const C = hap.Characteristic;
  const bulb = accessory.getService(hap.Service.Lightbulb);
  assert.equal(await bulb.getCharacteristic(C.Brightness).handleGetRequest(), 73);
  assert.equal(accessory.getService((hap.Service.Battery || hap.Service.BatteryService)).getCharacteristic(C.ChargingState).value, 1);
  assert.equal(accessory.getService(hap.Service.TemperatureSensor).getCharacteristic(C.CurrentTemperature).value, 23.5);
  assert.equal(accessory.getServiceById(hap.Service.MotionSensor, 'charging').getCharacteristic(C.MotionDetected).value, true);
  for (const service of accessory.services) for (const characteristic of service.characteristics) {
    if (characteristic.UUID === C.Identify.UUID) continue;
    assert.ok(!characteristic.props.perms.includes(hap.Perms.PAIRED_WRITE), `unexpected writable field ${characteristic.displayName}`);
  }
  const power = accessory.services.find(service => service.subtype === 'telemetry');
  assert.equal(power.characteristics.find(c => c.displayName === 'Charge Power').value, 500);
  assert.equal(accessory.context.hardwareQualified, false);
  await publish(s.monitors[0], -250);
  assert.equal(accessory.getServiceById(hap.Service.MotionSensor, 'charging').getCharacteristic(C.MotionDetected).value, false);
  assert.equal(accessory.getServiceById(hap.Service.MotionSensor, 'discharging').getCharacteristic(C.MotionDetected).value, true);
});
test('stale measurements return communication failure and recover on a fresh sample', async t => {
  const s = setup(t); s.manager.start(); await publish(s.monitors[0]);
  const entry = s.manager.entries.get('garage');
  s.monitors[0].current = { ...s.monitors[0].current, stale: true };
  s.manager.publish(entry, s.monitors[0].state());
  await assert.rejects(entry.accessory.getService(hap.Service.Lightbulb).getCharacteristic(hap.Characteristic.Brightness).handleGetRequest(), error => error.hapStatus === hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE || error === hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
  assert.equal(entry.faults[0].value, 1);
  await publish(s.monitors[0]); assert.equal(entry.faults[0].value, 0);
});
test('battery identity survives rename and IP change and coexists with a second battery', t => {
  const first = setup(t); first.manager.start(); const original = first.registered[0]; first.manager.stop();
  const next = setup(t, [{ id: 'garage', host: '192.0.2.11', name: 'Renamed Venus' }, { id: 'second', host: '192.0.2.12' }]);
  next.manager.configureAccessory(original); next.manager.start();
  assert.equal(next.registered.length, 1);
  assert.equal(next.manager.entries.get('garage').accessory.UUID, original.UUID);
  assert.notEqual(next.registered[0].UUID, original.UUID);
  assert.equal(next.monitors.length, 2);
});
test('explicit removal cleans up only cached Marstek accessories; invalid config retains them faulted', async t => {
  const first = setup(t); first.manager.start(); await publish(first.monitors[0]); const accessory = first.registered[0];
  const invalid = setup(t, [{ id: 'garage', host: '' }]); invalid.manager.configureAccessory(accessory); invalid.manager.start();
  assert.equal(invalid.removed.length, 0); assert.equal(invalid.monitors.length, 0);
  await assert.rejects(accessory.getService(hap.Service.Lightbulb).getCharacteristic(hap.Characteristic.Brightness).handleGetRequest());
  const disabled = setup(t, []); disabled.manager.configureAccessory(accessory); disabled.manager.start();
  assert.deepEqual(disabled.removed, [accessory]);
});
test('4.1.2 platform routes Marstek cache separately and starts it before validating GivEnergy', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'givhome-marstek-platform-'));
  const events = {};
  const s = setup(t, []);
  Object.assign(s.api, { user: { storagePath: () => directory }, on(name, fn) { events[name] = fn; } });
  const p = new GivHomeModbusPlatform(log, { flightRecorderDir: directory, enableReadOnlyPolling: false }, s.api);
  t.after(() => { p.marstek.stop(); clearInterval(p.flightRecorder.timer); fs.rmSync(directory, { recursive: true, force: true }); });
  const cached = new Accessory('Venus', hap.uuid.generate('cached-venus')); cached.context.marstekOwner = OWNER;
  p.configureAccessory(cached);
  assert.equal(p.accessories.length, 0);
  assert.equal(p.marstek.cached.size, 1);
  let started = false; p.marstek.start = () => { started = true; };
  p.didFinishLaunching(); assert.equal(started, true);
  let stopped = false; p.marstek.stop = () => { stopped = true; };
  events.shutdown(); assert.equal(stopped, true);
});
test('config migration preserves Marstek devices and all original schema contracts', () => {
  const { migrateExistingConfig } = require('../homebridge-ui/public/config-migration');
  const devices = [{ id: 'garage', host: '192.0.2.10', enabled: false }];
  assert.deepEqual(migrateExistingConfig({ marstekDevices: devices }).config.marstekDevices, devices);
  const schema = require('../config.schema.json');
  assert.deepEqual(normaliseDevices(schema.schema.properties.marstekDevices.default), []);
});


test('complete 4.1.2 platform reads a TCP simulator and publishes a native HomeKit accessory', async t => {
  const { createSimulator } = require('./marstek-simulator');
  const server = createSimulator();
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'givhome-marstek-e2e-'));
  const registered = [];
  const api = { hap, platformAccessory: Accessory, user: { storagePath: () => directory }, on() {},
    registerPlatformAccessories(_p, _a, accessories) { registered.push(...accessories); },
    unregisterPlatformAccessories() {}, updatePlatformAccessories() {} };
  const p = new GivHomeModbusPlatform(log, { flightRecorderDir: directory, enableReadOnlyPolling: false,
    marstekDevices: [{ id: 'simulated', host: '127.0.0.1', port: server.address().port }] }, api);
  t.after(async () => { p.marstek.stop(); clearInterval(p.flightRecorder.timer); server.closeClients(); await new Promise(resolve => server.close(resolve)); fs.rmSync(directory, { recursive: true, force: true }); });
  p.didFinishLaunching();
  const monitor = p.marstek.entries.get('simulated').monitor;
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('End-to-end monitor timed out')), 3000);
    monitor.once('state', state => { clearTimeout(timer); if (state.stale) reject(new Error(state.lastError)); else resolve(); });
  });
  assert.equal(registered.length, 1);
  assert.equal(await registered[0].getService(hap.Service.Lightbulb).getCharacteristic(hap.Characteristic.Brightness).handleGetRequest(), 73);
  assert.equal(p.latestModel, null, 'Marstek sample never becomes a GivEnergy telemetry model');
  assert.equal(p.marstek.entries.get('simulated').monitor.state().sample.model.controlSupported, false);
});
