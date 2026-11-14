'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs');
const root=path.resolve(process.env.GIVHOME_MODEL_ROOT||path.join(__dirname,'..')),load=p=>require(path.join(root,p));
const {ApiSimulator}=load('tools/local-api-simulator'),{LocalApiMonitor}=load('lib/marstek/local-api-monitor'),{ShadowService}=load('lib/marstek/shadow-service');
for(const [deadlineMs,drops,expectPlan] of [[3000,1,false],[5000,1,true],[5000,2,false]])test(`real paced UDP: collection ${deadlineMs}ms, lost responses ${drops}`,{timeout:15000},async t=>{
 const sim=await new ApiSimulator().start(),receive=sim.receive.bind(sim);let remaining=0;
 sim.receive=(data,peer)=>{const q=JSON.parse(data);if(q.method==='ES.GetMode'&&remaining){remaining--;return;}receive(data,peer);};
 const monitor=new LocalApiMonitor({host:'127.0.0.1',staleAfterSeconds:6,pollIntervalSeconds:2},{port:sim.port});let plans=0,stops=0,planAge=null;const events=[];
 await monitor.pollOnce();assert.equal(monitor.state().failures,0);remaining=drops;
 const service=new ShadowService({deadlineMs,readRecovery:true,readGateway:async()=>({unavailable:true}),contextProvider:()=>({priorityControlEnabled:true}),readVenus:async()=>{await monitor.pollOnce();const s=monitor.state();if(!s.sample||s.stale||s.failures){const e=Error('Fresh Venus API sample unavailable: '+s.lastError);e.code=s.failureCode;throw e;}return {observedAtMs:s.sample.model.observedAtMs,acDischargeW:0};},planProvider:async s=>{plans++;planAge=Date.now()-s.venus.observedAtMs;return {venusW:0,leaseUntilMs:Date.now(),reason:'read-only-observation'};},onUnavailable:async()=>{stops++;return {readOnly:true};}});
 service.on('continuity',e=>events.push(e));t.after(async()=>{service.stop();monitor.stop();await sim.close();});
 const start=Date.now();await service.tick();assert.equal(plans,expectPlan?1:0);if(expectPlan){assert(planAge<1000);assert(events.some(e=>e.phase==='read-recovered'));assert.equal(stops,0);}else{assert(stops>=1);assert.equal(service.lastResult.request.reason,'collection-timeout');}
 const row={deadlineMs,droppedModeResponses:drops,plans,stopRequests:stops,elapsedMs:Date.now()-start,acceptedEvidenceAgeMs:planAge,recovered:events.some(e=>e.phase==='read-recovered'),scope:'Real loopback UDP with production two-second quiet pacing; deliberate response loss; no physical actuator or deadline change deployed'};
 if(process.env.GIVHOME_MODEL_RESULTS)fs.appendFileSync(process.env.GIVHOME_MODEL_RESULTS,JSON.stringify(row)+'\n');
});
