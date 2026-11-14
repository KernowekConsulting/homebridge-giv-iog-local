'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {GivHomeModbusPlatform:P}=require('../index');
const {ShadowService}=require('../lib/marstek/shadow-service');
for(const enabled of [false,true])test('existing AIO poll supplies observation fields without another read; Marstek='+enabled,()=>{
 let published=0;const p={config:{marstekIntegrationEnabled:enabled},inverterSerial:'CH2344G083',health:{consecutiveFailures:0,totalPolls:0},updateAccessories:()=>{published++;return {attempts:1};},beta9PerfNowMs:()=>0,observeSolarTelemetry(){},log:{info(){}}};
 const m={socPercent:80,batterySignedPowerW:450,gridExportPowerW:30,gridImportPowerW:0,gridRawPowerW:30,pvPowerW:200,loadPowerW:620};
 P.prototype.handlePollSuccess.call(p,{response:{inverterSerial:'CH2344G083'},model:m,observedAtMs:1000,durationMs:250});
 assert.equal(published,1);assert.equal(p.latestModel,m);assert.deepEqual(p.marstekAioEvidence,{observedAtMs:1000,identityVerified:true,serial:'CH2344G083',socPercent:80,acDischargeW:450,gridExportW:30,gridImportW:0,gridRawPowerW:30,solarW:200,householdLoadW:620});
});
test('shadow receipt records a copy of existing AIO evidence without changing the plan',async()=>{
 const now=Date.now(),a={observedAtMs:now-1000,socPercent:80,gridExportW:30};let reads=0;
 const plan={reason:'held',venusW:0,leaseUntilMs:now};const s=new ShadowService({readGateway:async()=>{reads++;return {observedAtMs:now};},readVenus:async()=>{reads++;return {observedAtMs:now,acDischargeW:0};},contextProvider:()=>({aioEvidence:a}),planProvider:async()=>plan});
 await s.tick();assert.equal(reads,2);assert.deepEqual(s.lastResult.request.aioReadEvidence,a);assert.notEqual(s.lastResult.request.aioReadEvidence,a);assert.equal(s.lastResult.request.sitePlan,plan);s.stop();
});
