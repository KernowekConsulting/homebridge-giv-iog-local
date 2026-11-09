'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { recogniseControlCapabilities: recognise } = require('../lib/control-capabilities');
const { fixture } = require('./control-test-fixture');
let connections = 0;
require('net').Socket.prototype.connect = function () { connections++; throw new Error('Capability tests prohibit networking'); };
test.after(() => assert.equal(connections, 0));
const ac = { serial: 'CE2237G099', armFirmware: 212 };
for (const modelCode of [0x3001, 0x3002]) for (const batteryCapacityKwh of [5.2, 9.5, 19, 38]) {
  for (const [mode, pauseValue] of [['charge', 0], ['pauseCharge', 1], ['pauseDischarge', 2], ['pauseBoth', 3]]) {
    test(`AC ${modelCode.toString(16)} ${batteryCapacityKwh}kWh ${mode}: IOG and restart restore exact core settings`, async t => {
      const f = fixture(t, { serial: ac.serial, now: '2026-11-03T20:00:00Z', state: {
        0: modelCode, 21: 212, 20: 1, 94: 2330, 95: 530, 96: 1, 111: 50, 116: 80,
        31: 600, 32: 630, 313: 62, 314: 73
      }, config: { batteryCapacityKwh, enableOctopusSmartWindows: true, octopusApiKey: 'simulation', octopusAccountNumber: 'simulation',
        enableEvSmartWindowBatteryProtection: true, enableCheapOvernightCharging: false, iogHomeBatteryProtectionMode: mode, iogChargeTargetSoc: 90, graceMinutes: 0 } });
      const before = { ...f.registers };
      f.p.octopusState.dispatches = [{ start: new Date('2026-11-03T19:30Z'), end: new Date('2026-11-03T21:00Z') }];
      await f.p.applyApplianceAutomation();
      assert.equal(f.p.controlCapabilities.commandSupported, true);
      assert.equal(f.p.controlCapabilities.slots.count, 2);
      assert.equal(f.p.controlCapabilities.pause.times, false);
      assert.equal(f.p.controlCapabilities.power.charge, 111);
      assert.deepEqual(f.p.controlCapabilities.power.additionalAcLimits, [313, 314]);
      const family = mode === 'charge' ? 'charge' : 'pause';
      assert.equal(f.p.currentControlOwner(family)?.phase, 'active');
      if (mode === 'charge') { assert.equal(f.registers[116], 90); assert.equal(f.registers[95], 2100); }
      else { assert.equal(f.registers[318], pauseValue); assert.deepEqual(f.writes.map(w => w.slice(0, 2)), [[318, pauseValue]]); }
      const restarted = f.restart(); t.mock.timers.tick(61 * 60000);
      await restarted.applyApplianceAutomation();
      assert.deepEqual(f.registers, before);
      assert.equal(restarted.currentControlOwner(family), null);
      assert.equal(f.writes.some(([r]) => r >= 242 && r !== 318), false);
      assert.equal(f.reads.some(({r,n}) => r <= 319 && r+n > 319), false);
    });
  }
}
for (const firmware of [201, 202, 205, 212]) test(`AC firmware ${firmware}: pause is independent of core charge`, () => {
  const c = recognise({ ...ac, modelCode: 0x3002, armFirmware: firmware });
  assert.equal(c.commandSupported, true); assert.equal(c.slots.count, 2);
  assert.equal(c.pause.mode, firmware >= 202); assert.equal(c.pause.times, false);
});
for (const [firmware, count] of [[209, 2], [800, 2], [915, 2], [302, 2], [303, 10], [320, 10]]) {
  test(`Hybrid firmware ${firmware}: slot count ${count}, no assumed pause or AC power block`, () => {
    const c = recognise({serial:'ED2151G182',modelCode:0x2001,armFirmware:firmware});
    assert.equal(c.commandSupported,true);assert.equal(c.slots.count,count);
    assert.deepEqual(c.pause,{mode:false,times:false});assert.deepEqual(c.power.additionalAcLimits,[]);
    assert.equal(c.power.charge,111);assert.equal(c.power.discharge,112);
  });
}
test('AIO distinguishes extended slots, timed pause and command power from AC limits', () => {
  const c=recognise({serial:'CH2344G083',modelCode:0x8001,armFirmware:616});
  assert.equal(c.commandSupported,true);assert.equal(c.slots.count,10);
  assert.deepEqual(c.pause,{mode:true,times:true});assert.equal(c.power.charge,111);
  assert.deepEqual(c.power.additionalAcLimits,[313,314]);assert.equal(c.power.additionalAcLimitWrites,false);
});
for (const modelCode of [0x4001,0x6001,0x8201,0x4101,0x5001,0x5101,0x7001,0x8101,0x8301,0x2101,0x3003]) {
  test(`model ${modelCode.toString(16)} is recognised separately but not enabled by this release`, async t => {
    const c=recognise({...ac,modelCode});assert.equal(c.commandSupported,false);
    const f=fixture(t,{serial:ac.serial,state:{0:modelCode,21:212}});
    await assert.rejects(f.p.startTimedChargeCommand({minutes:30}),/supported model and firmware/);
    assert.deepEqual(f.writes,[]);
  });
}
test('later hybrid preserves all extended schedules through owned charge and restart cleanup', async t => {
  const f=fixture(t,{serial:'ED2151G182',state:{0:0x2001,21:303,96:1,94:2330,95:530,261:1800,262:1900}});
  const before={...f.registers};await f.p.startTimedChargeCommand({minutes:30});
  assert.equal(f.p.controlProfile.slots.length,20);
  await f.restart().cleanupApplianceCommandFamily('charge','finished');
  assert.deepEqual(f.registers,before);
});
test('older hybrid charges without HR318 reads even when pause tiles were configured', async t => {
  const f=fixture(t,{serial:'ED2151G182',state:{0:0x2001,21:915}});
  const read=f.p.readHoldingRegisters;
  f.p.readHoldingRegisters=async(r,n,label)=>{ if(r<=318 && r+n>318) throw new Error('unsupported pause bank'); return read(r,n,label); };
  await f.p.startTimedChargeCommand({minutes:30});
  await f.p.cleanupApplianceCommandFamily('charge','finished');
  const n=f.writes.length;await assert.rejects(f.p.startManualPauseCommand({pauseValue:2}),/Pause control is not supported/);
  assert.equal(f.writes.length,n);
});
test('battery capacity and user pause selection cannot manufacture a capability', () => {
  const input={serial:'ED2151G182',modelCode:0x2001,armFirmware:915};
  const c=recognise(input);
  for(const batteryCapacityKwh of [0,5.2,1000]) assert.deepEqual(recognise({...input,batteryCapacityKwh,pause:true,extendedSlots:true}),c);
});
test('extended hybrid stopped schedule survives journal reload and is restored for its next occurrence', async t => {
  const f=fixture(t,{serial:'ED2151G182',state:{0:0x2001,21:303,96:1,261:800,262:1000}});
  await f.p.requestEmergencyStop();assert.equal(f.registers[261],0);
  const restarted=f.restart();assert.equal(restarted.controlStorageFault,null);
  assert.equal(restarted.controlProfile.slots.length,20);
  t.mock.timers.tick(91*60000);await restarted.restoreDeferredControlWindows();
  assert.equal(f.registers[261],800);assert.equal(f.registers[262],1000);
});
test('AC without pause firmware remains chargeable and refuses pause before HR318 access', async t => {
  const f=fixture(t,{serial:ac.serial,state:{0:0x3002,21:201}});
  await f.p.startTimedChargeCommand({minutes:30});await f.p.cleanupApplianceCommandFamily('charge','end');
  const read=f.p.readHoldingRegisters;f.p.readHoldingRegisters=async(r,n,l)=>{
    assert.equal(r<=318&&r+n>318,false);return read(r,n,l);
  };
  await assert.rejects(f.p.startIogPauseProtectionCommand({mode:'pauseDischarge'}),/Pause control is not supported/);
});
test('disabling new CE actions does not strand an already owned charge during cleanup', async t => {
  const f=fixture(t,{serial:ac.serial,state:{0:0x3002,21:212,96:1,94:2330,95:530}});
  const before={...f.registers};await f.p.startTimedChargeCommand({minutes:30});
  f.p.applianceControl.masterGateSatisfied=false;f.p.applianceControl.features.ceAcCoupledLiveWrites=false;
  await f.p.cleanupApplianceCommandFamily('charge','disabled');assert.deepEqual(f.registers,before);
  await assert.rejects(f.p.startTimedChargeCommand({minutes:30}),/disabled/);
});
test('4.1.2 simulation publication is scoped, conditional and never claims physical validation', () => {
  const { publicationDecision }=require('./verify-observation-qualification');
  const input={pkg:{version:'4.1.2'},runtimeSha256:'reviewed',
    schema:{schema:{properties:{enableSolarObservation:{default:true},enableEmergencyStopTile:{default:true}}}},
    foundation:{automaticControl:false,qualified:false},record:{version:'4.1.2',runtimeSha256:'reviewed',
      status:'simulation-validated',networkIsolationPassed:true,faultAndRetentionPassed:true,evidence:'validation',
      stableReadiness:{version:'4.1.2',authorisedBy:'project owner',authorisedOn:'2026-11-04',condition:'simulation-passes',channel:'stable',scope:'ac-coupled-confirmations',
        resourceBudgetsClaimed:false,automaticSolarPlanningEnabled:false,physicalControlValidationClaimed:false},
      simulationValidation:{sourcePassed:true,packedPassed:true,nativeHapPassed:true,networkIsolationPassed:true,bothAcModelsPassed:true}}};
  assert.deepEqual(publicationDecision(input),{allowed:true,hardwareQualified:false});
  for(const change of [x=>x.record.simulationValidation.packedPassed=false,
    x=>x.record.simulationValidation.bothAcModelsPassed=false,x=>x.record.stableReadiness.physicalControlValidationClaimed=true,
    x=>x.runtimeSha256='changed',x=>x.record.stableReadiness.authorisedOn='2026-11-05',
    x=>{x.pkg.version=x.record.version=x.record.stableReadiness.version='4.1.3';}]){
    const altered=structuredClone(input);change(altered);assert.equal(publicationDecision(altered).allowed,false);
  }
  assert.equal(publicationDecision(input,true).allowed,false);
});

test('4.1.3 simulation publication is scoped, conditional and never claims physical validation', () => {
  const { publicationDecision }=require('./verify-observation-qualification');
  const input={pkg:{version:'4.1.3'},runtimeSha256:'reviewed',
    schema:{schema:{properties:{enableSolarObservation:{default:true},enableEmergencyStopTile:{default:true}}}},
    foundation:{automaticControl:false,qualified:false},record:{version:'4.1.3',runtimeSha256:'reviewed',
      status:'simulation-validated',networkIsolationPassed:true,faultAndRetentionPassed:true,evidence:'validation',
      stableReadiness:{version:'4.1.3',authorisedBy:'project owner',authorisedOn:'2026-11-08',condition:'simulation-passes',channel:'stable',scope:'ce-ac-upgrade-regression',
        resourceBudgetsClaimed:false,automaticSolarPlanningEnabled:false,physicalControlValidationClaimed:false},
      simulationValidation:{sourcePassed:true,packedPassed:true,nativeHapPassed:true,networkIsolationPassed:true,bothAcModelsPassed:true}}};
  assert.deepEqual(publicationDecision(input),{allowed:true,hardwareQualified:false});
  for(const change of [x=>x.record.simulationValidation.packedPassed=false,
    x=>x.record.simulationValidation.bothAcModelsPassed=false,x=>x.record.stableReadiness.physicalControlValidationClaimed=true,
    x=>x.runtimeSha256='changed',x=>x.record.stableReadiness.authorisedOn='2026-11-05',
    x=>{x.pkg.version=x.record.version=x.record.stableReadiness.version='4.1.4';}]){
    const altered=structuredClone(input);change(altered);assert.equal(publicationDecision(altered).allowed,false);
  }
  assert.equal(publicationDecision(input,true).allowed,false);
});
test('Marstek beta publication requires exact reviewed runtime, beta channel and simulated evidence',()=>{
 const {publicationDecision}=require('./verify-observation-qualification');const input={pkg:{version:'4.2.0-beta.1',publishConfig:{tag:'beta'}},runtimeSha256:'reviewed',schema:{schema:{properties:{enableSolarObservation:{default:true},enableEmergencyStopTile:{default:true},marstekIntegrationEnabled:{default:false}}}},foundation:{automaticControl:false,qualified:false},record:{version:'4.2.0-beta.1',runtimeSha256:'reviewed',status:'simulation-validated',networkIsolationPassed:true,faultAndRetentionPassed:true,evidence:'validation',betaPublication:{version:'4.2.0-beta.1',authorizedBy:'project owner',authorizedOn:'2026-11-09',channel:'beta',scope:'marstek-commissioning',condition:'all-checks-pass',physicalValidationClaimed:false,resourceBudgetsClaimed:false,commissioningRequired:true},simulationValidation:{sourcePassed:true,packedPassed:true,nativeHapPassed:true,networkIsolationPassed:true,bothAcModelsPassed:true}}};assert.deepEqual(publicationDecision(input,true),{allowed:true,hardwareQualified:false});assert.equal(publicationDecision(input,false).allowed,false);
 for(const change of [x=>x.pkg.publishConfig.tag='latest',x=>x.record.simulationValidation.packedPassed=false,x=>x.runtimeSha256='changed',x=>x.record.betaPublication.physicalValidationClaimed=true,x=>x.record.betaPublication.commissioningRequired=false,x=>x.pkg.version='4.2.0',x=>x.schema.schema.properties.marstekIntegrationEnabled.default=true]){const v=structuredClone(input);change(v);assert.equal(publicationDecision(v,true).allowed,false);}
});
