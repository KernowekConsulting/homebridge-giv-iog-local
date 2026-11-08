'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { fixture } = require('./control-test-fixture');
const { buildApplianceControlConfig } = require('../lib/appliance-integrated-control');
const { DirectLocalReadOnlyClient } = require('../lib/direct-modbus-client');
const { GivHomeModbusPlatform: P } = require('../index');

// Exercise production command, ownership, automation and recovery methods, replacing
// only the transport/register device. Any accidental network use fails the suite.
let connections = 0;
require('net').Socket.prototype.connect = function () { connections++; throw new Error('No network in CE simulations'); };
test.after(() => assert.equal(connections, 0));
const baseConfig = {
  enableApplianceControl: true, applianceControlAcknowledgement: 'ENABLE_GIVHOME_APPLIANCE_CONTROL',
  enableCheapOvernightCharging: false, enableOctopusSmartWindows: true,
  octopusApiKey: 'simulation', octopusAccountNumber: 'simulation',
  enableEvSmartWindowBatteryProtection: true, graceMinutes: 0
};
function device(t, config = {}, state = {}) {
  return fixture(t, { serial: 'CE2237G099', now: '2026-11-03T20:00:00Z',
    config: { ...baseConfig, ...config }, state: {
      0: 0x3001, 20: 1, 94: 2330, 95: 530, 96: 1, 111: 50, 116: 80,
      31: 600, 32: 630, 319: 0, 320: 0, ...state
    } });
}
function slot(p) {
  p.octopusState.dispatches = [{ start: new Date('2026-11-03T19:30:00Z'), end: new Date('2026-11-03T21:00:00Z') }];
}
test('ordinary feature configuration ignores retired engineering flags; master off remains off', () => {
  assert.equal(buildApplianceControlConfig(baseConfig).features.ceAcCoupledLiveWrites, true);
  assert.equal(buildApplianceControlConfig({ ...baseConfig, enableCeAcCoupledLiveWrites: false }).features.ceAcCoupledLiveWrites, true);
  assert.equal(buildApplianceControlConfig({ ...baseConfig, enableApplianceControl: false }).features.ceAcCoupledLiveWrites, false);
});
for (const [mode, value] of [['charge', null], ['pauseDischarge', 2], ['pauseCharge', 1], ['pauseBoth', 3]]) {
  test(`Iain CE: IOG ${mode} starts, survives restart and restores prior settings at slot end`, async t => {
    const f = device(t, { iogHomeBatteryProtectionMode: mode, iogChargeTargetSoc: 90 });
    const before = { ...f.registers }; slot(f.p);
    await f.p.applyApplianceAutomation();
    const family = mode === 'charge' ? 'charge' : 'pause';
    assert.equal(f.p.currentControlOwner(family)?.phase, 'active');
    if (mode === 'charge') {
      assert.equal(f.registers[96], 1); assert.equal(f.registers[94], 2000);
      assert.equal(f.registers[95], 2100); assert.equal(f.registers[116], 90);
      assert.equal(f.registers[111], 100); assert.equal(f.registers[318], 0);
    } else {
      assert.deepEqual(f.writes.map(([r, v]) => [r, v]), [[318, value]]);
      assert.equal(f.registers[96], before[96]);
    }
    const ownerId = f.p.currentControlOwner(family).id;
    const restarted = f.restart(); slot(restarted);
    assert.equal(restarted.currentControlOwner(family).id, ownerId);
    t.mock.timers.tick(61 * 60000);
    await restarted.applyApplianceAutomation();
    assert.equal(restarted.currentControlOwner(family), null);
    assert.deepEqual(f.registers, before);
    assert.equal(f.writes.some(([r]) => r >= 242 && r !== 318), false);
    assert.equal(f.reads.some(({ r, n }) => r <= 319 && r + n > 319), false);
  });
}
for (const identity of [
  { serial: 'CE00000000', modelCode: 0x3001, armFirmware: 212 },
  { serial: 'CE2237G099', modelCode: 0x8001, armFirmware: 616 },
  { serial: 'CE2237G099', modelCode: null },
  { serial: '', modelCode: 0x3001, armFirmware: 212 }
]) test(`identity/model rejection sends no writes: ${JSON.stringify(identity)}`, async t => {
  const f = device(t); f.p.readControlIdentity = async () => identity;
  await assert.rejects(f.p.startTimedChargeCommand({ minutes: 30 }), /matching inverter identity, supported model/);
  assert.deepEqual(f.writes, []);
});
test('identity timeout sends no writes', async t => {
  const f = device(t); f.p.readControlIdentity = async () => { throw new Error('identity timeout'); };
  await assert.rejects(f.p.startTimedChargeCommand({ minutes: 30 }), /identity timeout/);
  assert.deepEqual(f.writes, []);
});
test('missing required core word sends no writes', async t => {
  const f = device(t); const read = f.p.readHoldingRegisters;
  f.p.readHoldingRegisters = async (r, n, label) => r === 31 ? [] : read(r, n, label);
  await assert.rejects(f.p.startTimedChargeCommand({ minutes: 30 }), /incomplete/);
  assert.deepEqual(f.writes, []);
});
test('wrong model blocks Emergency Stop before any register write', async t => {
  const f = device(t); f.p.readControlIdentity = async () => ({ serial: 'CE2237G099', modelCode: 0x8001, armFirmware: 616 });
  await assert.rejects(f.p.requestEmergencyStop(), /matching inverter identity, supported model/);
  assert.deepEqual(f.writes, []);
});
for (const state of [{ 94: 2360 }, { 96: 2 }, { 111: 101 }, { 31: 2360 }, { 318: 4 }]) {
  test(`invalid required control refuses before writes: ${JSON.stringify(state)}`, async t => {
    const f = device(t, {}, state);
    const command = 318 in state ? () => f.p.startIogPauseProtectionCommand({ mode: 'pauseDischarge' })
      : () => f.p.startTimedChargeCommand({ minutes: 30 });
    await assert.rejects(command()); assert.deepEqual(f.writes, []);
  });
}
test('master off blocks acquisition and Emergency Stop even with the retired engineering flag enabled', async t => {
  const f = device(t, { enableApplianceControl: false, enableCeAcCoupledLiveWrites: true });
  f.p.applianceControl.masterGateSatisfied = false;
  await assert.rejects(f.p.startTimedChargeCommand({ minutes: 30 }), /Appliance control is disabled/);
  await assert.rejects(f.p.requestEmergencyStop(), /not enabled/);
  slot(f.p); await f.p.applyApplianceAutomation();
  assert.deepEqual(f.writes, []);
});
for (const model of [0x3001, 0x3002]) for (const legacy of [undefined, false, true]) {
  const config = legacy === undefined ? {} : { enableCeAcCoupledLiveWrites: legacy, ceAcCoupledLiveWriteAcknowledgement: 'obsolete-token' };
  test(`upgrade regression model=${model.toString(16)} legacy=${legacy}: manual start, restart, stop restore prestate`, async t => {
    const f = device(t, config, { 0: model }); const before = { ...f.registers };
    await f.p.startTimedChargeCommand({ kind: 'charge30', displayName: 'Charge 30m', minutes: 30 });
    assert.equal(f.registers[96], 1); assert.equal(f.registers[94], 2000); assert.equal(f.registers[95], 2030);
    assert.equal(f.p.currentControlOwner('charge').phase, 'active');
    const restarted = f.restart();
    await restarted.cleanupApplianceCommandFamily('charge', 'user stop');
    assert.deepEqual(f.registers, before);
    assert.ok(f.writes.some(([r,v]) => r === 96 && v === 1));
  });
  test(`upgrade regression model=${model.toString(16)} legacy=${legacy}: IOG start and end restore prestate`, async t => {
    const f = device(t, { ...config, iogHomeBatteryProtectionMode: 'charge' }, { 0: model }); const before = { ...f.registers }; slot(f.p);
    await f.p.applyApplianceAutomation();
    assert.equal(f.p.currentControlOwner('charge')?.phase, 'active');
    assert.equal(f.registers[94], 2000); assert.equal(f.registers[95], 2100);
    const restarted = f.restart(); slot(restarted);
    t.mock.timers.tick(61 * 60000); await restarted.applyApplianceAutomation();
    assert.equal(restarted.currentControlOwner('charge'), null); assert.deepEqual(f.registers, before);
  });
}
for (const config of [{ enableEvSmartWindowBatteryProtection: false }, { enableOctopusSmartWindows: false }]) {
  test(`ordinary feature off remains off despite retired false: ${JSON.stringify(config)}`, async t => {
    const f = device(t, { enableCeAcCoupledLiveWrites: false, ...config }); slot(f.p);
    await f.p.applyApplianceAutomation(); assert.deepEqual(f.writes, []);
  });
}
test('retired false never bypasses fresh identity rejection', async t => {
  const f = device(t, { enableCeAcCoupledLiveWrites: false });
  f.p.readControlIdentity = async () => ({ serial: 'CE2237G099', modelCode: 0x8001, armFirmware: 616 });
  await assert.rejects(f.p.startTimedChargeCommand({ minutes: 30 }), /matching inverter identity, supported model/);
  assert.deepEqual(f.writes, []);
});
test('fresh identity is checked again on acquisition and cleanup', async t => {
  const f = device(t); let count = 0;
  f.p.readControlIdentity = async () => ({ serial: ++count <= 2 ? 'CE2237G099' : 'CE00000000', modelCode: 0x3001, armFirmware: 212 });
  await f.p.startTimedChargeCommand({ minutes: 30 }); await f.p.cleanupApplianceCommandFamily('charge', 'done');
  const n = f.writes.length;
  await assert.rejects(f.p.startTimedChargeCommand({ minutes: 30 }), /matching inverter identity, supported model/);
  assert.equal(f.writes.length, n);
});
test('ignored charge-window write fails readback before charge enable', async t => {
  const f = device(t), write = f.p.writeDirectRegister;
  f.p.writeDirectRegister = async (r, ...rest) => { if (r !== 94) await write(r, ...rest); };
  await assert.rejects(f.p.startTimedChargeCommand({ minutes: 30 }), /pre-enable readback/);
  assert.equal(f.writes.some(([r, v]) => r === 96 && v === 1), false);
  f.p.writeDirectRegister = write;
  await f.p.cleanupApplianceCommandFamily('charge', 'failed start');
  assert.equal(f.registers[94], 2330); assert.equal(f.registers[96], 1);
});
test('ignored pause-mode write never reports active', async t => {
  const f = device(t, { iogHomeBatteryProtectionMode: 'pauseDischarge' });
  f.p.writeDirectRegister = async () => {};
  await assert.rejects(f.p.startIogPauseProtectionCommand({ mode: 'pauseDischarge' }), /readback mismatch/);
  assert.notEqual(f.p.currentControlOwner('pause')?.phase, 'active');
});
for (const fault of ['before', 'after']) for (let at = 1; at <= 7; at++) {
  test(`CE interrupted charge ${fault} write ${at}: exact recovery after restart`, async t => {
    const f = device(t), before = { ...f.registers }, write = f.p.writeDirectRegister; let calls = 0;
    f.p.writeDirectRegister = async (...args) => {
      if (++calls !== at) return write(...args);
      if (fault === 'after') await write(...args);
      throw new Error('simulated connection lost');
    };
    try { await f.p.startTimedChargeCommand({ minutes: 30 }, { targetSoc: 100 }); }
    catch (err) { assert.match(err.message, /simulated connection lost/); }
    assert.ok(calls >= at, 'the selected interruption was exercised');
    const restarted = f.restart();
    await restarted.cleanupApplianceCommandFamily('charge', 'interrupted start');
    assert.deepEqual(f.registers, before); assert.equal(restarted.currentControlOwner('charge'), null);
  });
}
test('external schedule change survives owned cleanup', async t => {
  const f = device(t); await f.p.startTimedChargeCommand({ minutes: 30 });
  f.registers[94] = 2200; f.registers[95] = 2300; const n = f.writes.length;
  const result = await f.p.cleanupApplianceCommandFamily('charge', 'slot ended');
  assert.equal(result.superseded, true); assert.equal(f.writes.length, n);
  assert.equal(f.registers[94], 2200);
});
for (const fault of ['before', 'after']) for (let at = 1; at <= 6; at++) {
  test(`CE interrupted restoration ${fault} write ${at}: restart completes without repeating applied write`, async t => {
    const f = device(t), before = { ...f.registers };
    await f.p.startTimedChargeCommand({ minutes: 30 }, { targetSoc: 100 });
    const write = f.p.writeDirectRegister; let calls = 0, affected;
    f.p.writeDirectRegister = async (...args) => {
      if (++calls !== at) return write(...args);
      affected = args.slice(0, 2);
      if (fault === 'after') await write(...args);
      throw new Error('restoration connection lost');
    };
    const n = f.writes.length;
    try { await f.p.cleanupApplianceCommandFamily('charge', 'end'); }
    catch (err) { assert.match(err.message, /restoration connection lost/); }
    assert.ok(affected, 'the selected restoration interruption was exercised');
    const restarted = f.restart();
    await restarted.cleanupApplianceCommandFamily('charge', 'resume');
    assert.deepEqual(f.registers, before); assert.equal(restarted.currentControlOwner('charge'), null);
    if (fault === 'after' && affected) assert.equal(f.writes.slice(n).filter(([r, v]) => r === affected[0] && v === affected[1]).length, 1);
  });
}
test('production transport identity reader and every CE register read reject wrong responders', async t => {
  const f = device(t); let serial = 'CE2237G099';
  t.mock.method(DirectLocalReadOnlyClient.prototype, 'readHoldingRegisters', async (r, n) => ({
    inverterSerial: serial, values: Array.from({ length: n }, (_, i) => r === 21 ? 212 : f.registers[r + i])
  }));
  assert.deepEqual(await P.prototype.readControlIdentity.call(f.p), { serial, modelCode: 0x3001, armFirmware: 212 });
  assert.deepEqual(await P.prototype.readHoldingRegisters.call(f.p, 94, 3), [2330, 530, 1]);
  serial = 'CE00000000';
  await assert.rejects(P.prototype.readHoldingRegisters.call(f.p, 94, 3), /identity does not match/);
});
