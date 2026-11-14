'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {ApiSimulator}=require('./local-api-simulator');
const {LocalApiClient}=require('../lib/marstek/local-api-client');
const {LocalApiMonitor}=require('../lib/marstek/local-api-monitor');
const {LocalApiControlSession}=require('../lib/marstek/local-api-control-session');
const {SiteCoordinator}=require('../lib/marstek/site-coordinator');
test('real UDP at the production two-second pacing holds a timed charge without renewal despite a 4.2-second response lag',async t=>{
 const sim=await new ApiSimulator({actuationDelayMs:4200}).start();
 const device={host:'127.0.0.1',port:sim.port,maxChargeW:2500,maxDischargeW:2500,staleAfterSeconds:6,pollIntervalSeconds:2};
 const client=new LocalApiClient({host:device.host,port:sim.port});
 const monitor=new LocalApiMonitor(device,{port:sim.port});
 const session=new LocalApiControlSession(device,{client,qualified:true});
 t.after(async()=>{await session.close();monitor.stop();await sim.close();});
 const planner=new SiteCoordinator({commandLeaseMs:8000});let measured=false,acceptedWrites=0;
 for(let n=0;n<4;n++){
  await monitor.pollOnce();const m=monitor.state().sample.model,now=Date.now();
  const s={nowMs:now,gateway:{unavailable:true},venus:{observedAtMs:m.observedAtMs,socPercent:m.socPercent,acDischargeW:m.acSignedW,acDirectionQualified:true,deviceMode:m.deviceMode},context:{localApiTimed:true,priorityControlEnabled:true,overnightEnabled:true,nightActive:true,nightTargetSoc:100,nightEndAtMs:now+300000,aioEvidence:{observedAtMs:now,identityVerified:true,singleAio:true,socPercent:60,acDischargeW:-1000}}};
  const p=planner.step(s);assert.equal(p.evidenceKind,'scheduled-battery');const result=await session.apply(p,s);assert(['effect-confirmed','timed-action-running'].includes(result.status));assert(sim.expires-Date.now()<=120000);assert(sim.expires>Date.now());measured ||= m.acSignedW< -50;if(n===0)acceptedWrites=sim.requests.filter(q=>q.method==='ES.SetMode'&&q.params.config.passive_cfg.power<0).length;
 }
 assert(measured,'Settled charging must be physically reported by the UDP plant');
 const set=sim.requests.filter(x=>x.method==='ES.SetMode'&&x.params.config.passive_cfg.power<0);
 assert.equal(set.length,acceptedWrites,'Accepted timed charge must not be renewed each poll');
 for(let n=1;n<sim.requests.length;n++)assert(sim.requests[n].at-sim.requests[n-1].at>=1950,'Production quiet interval retained');
 await session.revoke();assert.equal(session.status,'stop-measured');
});
