'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {SiteCoordinator}=require('../lib/marstek/site-coordinator');
function sample(a=70,v=70){return {nowMs:10000,gateway:{observedAtMs:10000,onlineCount:1,units:[{socPercent:a}],gridExportW:0,aioDischargeW:1000},venus:{observedAtMs:10000,socPercent:v,acDischargeW:0,acDirectionQualified:true,identityQualified:true},context:{ecoEnabled:true,localApiTimed:true}};}
function settle(p,s,n=12){let r;for(let i=0;i<n;i++){s.nowMs+=8000;s.gateway.observedAtMs=s.venus.observedAtMs=s.nowMs;r=p.step(s);s.venus.acDischargeW=r.venusW;s.gateway.aioDischargeW=1000-r.venusW;}return r;}
test('equal SOC shares capacity rather than displacing the entire AIO output',()=>{const s=sample(),r=settle(new SiteCoordinator(),s);assert(Math.abs(r.venusW-275)<2);assert.equal(r.aioW,0);});
test('observed 29/71 gap gives Venus a larger bounded contribution',()=>{const s=sample(29,71),r=settle(new SiteCoordinator({venusOutputW:2500,higherDischargeLimitConfirmed:true}),s);assert.equal(r.venusW,950);assert(r.ecoAllocation.correctionW>750);});
for(const limit of [800,2500])for(const count of [1,2,3])test(`six hour house/PV/load-step model: ${count} AIO, ${limit}W Venus`,()=>{
 const p=new SiteCoordinator({venusOutputW:limit,higherDischargeLimitConfirmed:limit>800,aioReserve:5,venusReserve:5}),s=sample(65,95);s.gateway.units=Array.from({length:count},()=>({socPercent:65}));s.gateway.onlineCount=count;let energy=0,initialGap=30,minGap=30;
 for(let i=0;i<2700;i++){
  const demand=i%600<50?2300:i%600<100?-500:350+(i%240<100?400:0);
  s.nowMs+=8000;s.gateway.observedAtMs=s.venus.observedAtMs=s.nowMs;
  s.gateway.gridExportW=s.gateway.aioDischargeW+s.venus.acDischargeW-demand;
  const r=p.step(s),v=r.venusW;assert(v<=limit&&v>=-2500);if(v>0)assert(v<=Math.max(0,demand-50)+1);
  const a=demand-v;s.venus.socPercent=Math.min(100,s.venus.socPercent-v*8/3600000/5.12*100);
  for(const u of s.gateway.units)u.socPercent=Math.min(100,u.socPercent-a*8/3600000/(13.5*count)*100);
  s.venus.acDischargeW=v;s.gateway.aioDischargeW=a;energy+=Math.max(0,v)*8/3600000;
  minGap=Math.min(minGap,s.venus.socPercent-s.gateway.units[0].socPercent);
 }
 assert(energy>1);assert(minGap<initialGap/2);assert(s.venus.socPercent>=5);
});
test('higher AIO SOC conserves Venus and low demand cannot be converted to extra export',()=>{const s=sample(90,30),p=new SiteCoordinator();assert.equal(settle(p,s).venusW,0);s.venus.socPercent=90;settle(p,s);s.gateway.aioDischargeW=0;s.gateway.gridExportW=s.venus.acDischargeW-75;s.nowMs+=8000;s.gateway.observedAtMs=s.venus.observedAtMs=s.nowMs;assert(p.step(s).venusW<=25);});
test('charge, export, IOG, grace/hold and stale IOG keep priority over balancing',()=>{for(const kind of ['charge','export','iog','grace','hold','stale-iog']){const s=sample(29,71),p=new SiteCoordinator();if(['charge','export'].includes(kind))s.intent={mode:kind,target:kind==='charge'?100:10,deadlineMs:100000};else if(kind==='hold')s.context.automationHold=true;else Object.assign(s.context,{iogEnabled:true,iogActive:true,iogMode:kind==='grace'?'pause':'charge',iogFresh:kind!=='stale-iog',iogFetchedAtMs:s.nowMs,iogTargetSoc:100});const r=p.step(s);assert.notEqual(r.controlKind,'eco',kind);assert.equal(r.ecoAllocation,undefined);}});
test('Venus reserve and deliberate AIO charging prohibit Venus discharge',()=>{for(const charge of [false,true]){const s=sample(70,charge?80:20),p=new SiteCoordinator();if(charge)s.gateway.aioDischargeW=-1000;assert(p.step(s).venusW<=0);}});
test('repeated frames and legacy Modbus policy retain established behaviour',()=>{const s=sample(),p=new SiteCoordinator();const first=p.step(s);assert.equal(p.step(s).venusW,first.venusW);delete s.context.localApiTimed;const r=new SiteCoordinator().step(s);assert.equal(r.ecoAllocation,undefined);assert.equal(r.venusW,300);});
const hap=require('@homebridge/hap-nodejs'),{SiteHomebridge}=require('../lib/marstek/site-homebridge');class Accessory extends hap.Accessory{constructor(n,id){super(n,id);this.context={};}}
function rig(t){let now=10000;const dir=fs.mkdtempSync(path.join(os.tmpdir(),'eco-balance-')),api={hap,platformAccessory:Accessory,user:{storagePath:()=>dir},registerPlatformAccessories(){}};const ui=new SiteHomebridge({debug(){}},api,{marstekTimedApi:true,marstekSitePreviewEnabled:true,marstekGatewaySerial:'GW2412G068',marstekShadowBatteryId:'v',marstekDevices:[{id:'v',host:'127.0.0.1'}]},{now:()=>now});ui.start();t.after(()=>{ui.stop();fs.rmSync(dir,{recursive:true,force:true});});const s=sample();return {ui,s,tick:()=>{now+=8000;s.nowMs=s.gateway.observedAtMs=s.venus.observedAtMs=now;return ui.sample(s);}};}
for(const hold of ['qualification-stale','identity-unqualified'])test('fresh matching qualification recovers '+hold+' without reviving Export To',t=>{const r=rig(t);r.ui.state.start('export',10000);r.s.venus.identityQualified=false;r.s.venus.identityQualificationReason=hold==='qualification-stale'?'identity-stale':'settings-mismatch';r.tick();assert.equal(r.ui.state.intent,null);assert.equal(r.ui.authority.state.hold,hold);for(let i=0;i<4;i++)r.tick();assert.equal(r.ui.authority.state.hold,hold);r.s.venus.identityQualified=true;delete r.s.venus.identityQualificationReason;for(let i=0;i<3;i++)r.tick();assert.equal(r.ui.authority.state.hold,null);assert.equal(r.ui.state.intent,null);assert.equal(r.ui.latest.result.controlKind,'eco');});
test('duplicates and mismatching identities never release a qualification hold',t=>{const r=rig(t);r.ui.authority.hold('identity-unqualified');r.s.venus.identityQualified=false;for(let i=0;i<10;i++)r.tick();assert.equal(r.ui.authority.state.hold,'identity-unqualified');r.s.venus.identityQualified=true;r.tick();for(let i=0;i<10;i++){r.s.nowMs+=100;r.ui.sample(r.s);}assert.equal(r.ui.authority.state.hold,'identity-unqualified');});
test('qualification distinguishes aged identity from settings/device changes',async t=>{
 const {LocalApiCommissioning,signature,save}=require('../lib/marstek/local-api-commissioning'),dir=fs.mkdtempSync(path.join(os.tmpdir(),'eco-identity-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));let now=100000;
 const config={marstekGatewaySerial:'GW2412G068',marstekGatewayHost:'127.0.0.1',marstekDevices:[{id:'v',host:'127.0.0.1'}]},q=new LocalApiCommissioning(config,dir,{now:()=>now}),binding={model:'VenusE 3.0',mac:'cc:c8:37:a1:b4:40',firmware:{api:'144'},src:'VenusE 3.0-ccc837a1b440'};
 save(q.paths.certificate,{schema:1,transport:'local-api',policyRevision:'priority-20261111',tests:['lease-budget-feedback'],requestQuietMs:2000,signature:signature(config),binding});
 const model={binding,requestQuietMs:2000,identityAtMs:now-require('../lib/marstek/local-api-monitor').IDENTITY_MAX_AGE_MS-1};assert.equal(await q.qualification(null,model),null);assert.equal(q.lastQualification.reason,'identity-stale');model.identityAtMs=now;assert(await q.qualification(null,model));
 model.binding={...binding,mac:'11:22:33:44:55:66'};assert.equal(await q.qualification(null,model),null);assert.equal(q.lastQualification.reason,'identity-mismatch');model.binding=binding;config.marstekLocalApiPort=30001;assert.equal(await q.qualification(null,model),null);assert.equal(q.lastQualification.reason,'settings-mismatch');
});
test('three fresh qualification observations can span ordinary communication gaps',t=>{const r=rig(t);r.ui.authority.hold('qualification-stale');r.tick();r.s.nowMs+=45000;r.ui.now=()=>r.s.nowMs;r.s.gateway.observedAtMs=r.s.venus.observedAtMs=r.s.nowMs;r.ui.sample(r.s);r.s.nowMs+=8000;r.s.gateway.observedAtMs=r.s.venus.observedAtMs=r.s.nowMs;r.ui.sample(r.s);assert.equal(r.ui.authority.state.hold,null);});
test('single AIO verified site meter bridges Gateway gaps with original timestamp and serial',()=>{
 let now=100000;const {GatewayFeed}=require('../lib/marstek/gateway-feed'),f=new GatewayFeed({serial:'GW2412G068',aioSerial:'CH2344G083'},{now:()=>now,client:{}});f.knownCount=1;f.topologySample={observedAtMs:now-50000,values:[0,1,0]};
 const a={singleAio:true,identityVerified:true,serial:'CH2344G083',observedAtMs:now-10000,socPercent:29,acDischargeW:930,gridExportW:0,gridImportW:15,householdLoadW:917,solarW:0};
 const get=()=>f.snapshot({aioEvidence:a,allowAioSiteFallback:true}),s=get();assert.equal(s.siteMeterSource,'aio');assert.equal(s.gridExportW,-15);assert.equal(s.observedAtMs,a.observedAtMs);assert.equal(s.aioDischargeW,930);assert.throws(()=>f.snapshot({aioEvidence:a}));
 for(const mutation of [()=>a.serial='OTHER',()=>a.observedAtMs=now-31000,()=>f.knownCount=2,()=>f.topologySample.observedAtMs=now-86400001,()=>a.householdLoadW=NaN,()=>f.identityFault=true]){const old={...a},count=f.knownCount,ts=f.topologySample.observedAtMs;mutation();assert.throws(get);Object.assign(a,old);f.knownCount=count;f.topologySample.observedAtMs=ts;f.identityFault=false;}
});
test('AIO fallback recovery tolerates a 30 second evidence cadence without accepting stale power',t=>{
 const r=rig(t);r.ui.authority.hold('operator-hold');r.s.gateway.siteMeterSource='aio';r.tick();r.ui.now=()=>r.s.nowMs;
 for(let i=0;i<2;i++){r.s.nowMs+=31000;r.s.gateway.observedAtMs=r.s.venus.observedAtMs=r.s.nowMs;r.ui.sample(r.s);}
 assert.equal(r.ui.authority.state.hold,null);assert.equal(r.ui.state.intent,null);
 r.ui.authority.hold('operator-hold');r.s.nowMs+=31000;for(let i=0;i<4;i++){r.s.nowMs+=1000;r.s.venus.observedAtMs=r.s.nowMs;r.ui.sample(r.s);}assert.equal(r.ui.authority.state.hold,'operator-hold');
});
test('expired proposal uses fresh measured Eco power to progress, without reviving old authority',()=>{
 const {ProposalGuard}=require('../lib/marstek/proposal-guard'),guard=new ProposalGuard(),s=sample();s.venus.deviceMode='Passive';let p={controlKind:'eco',venusW:900,aioW:0,combinedSoc:70,leaseUntilMs:s.nowMs+30000};assert.equal(guard.apply(p,s).venusW,300);
 s.nowMs+=31000;s.gateway.observedAtMs=s.venus.observedAtMs=s.nowMs;s.venus.acDischargeW=299;p={...p,leaseUntilMs:s.nowMs+30000};assert.equal(guard.apply(p,s).venusW,599);
 const paused=guard.apply({...p,venusW:0,reason:'held'},s);assert.equal(paused.venusW,0);
 s.nowMs+=31000;s.gateway.observedAtMs=s.venus.observedAtMs=s.nowMs;s.venus.acDischargeW=300;s.venus.observedAtMs-=31000;assert.equal(guard.apply({...p,leaseUntilMs:s.nowMs+30000},s).venusW,300);
});
test('switching to a fresh earlier AIO meter does not invent a clock regression or restart ramp at zero',()=>{
 const {ProposalGuard}=require('../lib/marstek/proposal-guard'),p=new SiteCoordinator({venusOutputW:2500,higherDischargeLimitConfirmed:true}),guard=new ProposalGuard(),s=sample(29,71);s.venus.deviceMode='Passive';s.venus.acDischargeW=300;s.gateway.aioDischargeW=700;s.gateway.siteMeterSource='gateway';let r=p.step(s);r=guard.apply(r,s);assert(r.venusW>=300);
 s.nowMs+=8000;s.venus.observedAtMs=s.nowMs;s.gateway.siteMeterSource='aio';s.gateway.observedAtMs-=1000;s.venus.acDischargeW=300;
 r=guard.apply(p.step(s),s);assert.equal(r.reason,'eco-house-support');assert(r.venusW>300&&r.venusW<=600);
 s.nowMs+=8000;s.venus.observedAtMs=s.nowMs;s.gateway.observedAtMs-=1;assert.equal(guard.apply(p.step(s),s).reason,'guard-time-regression');
});
test('cached site layout survives a restart but never supplies cached power or extends its lifetime',()=>{
 const {GatewayFeed}=require('../lib/marstek/gateway-feed');let now=100000000;const old=now-3600000,layout={serial:'GW2412G068',onlineCount:1,units:[{socPercent:95}],topologyObservedAtMs:old,observedAtMs:now-1000,siteMeterSource:'aio'};
 const make=x=>new GatewayFeed({serial:'GW2412G068',aioSerial:'CH2344G083'},{now:()=>now,client:{},initialTopology:x}),f=make(layout),a={singleAio:true,identityVerified:true,serial:'CH2344G083',observedAtMs:now-1000,socPercent:26,acDischargeW:800,gridExportW:0,gridImportW:0,householdLoadW:800,solarW:0};
 assert.equal(f.knownCount,1);assert.equal(f.topologySample,undefined);assert.throws(()=>f.snapshot());const g=f.snapshot({aioEvidence:a,allowAioSiteFallback:true});assert.equal(g.topologyObservedAtMs,old);assert.equal(g.observedAtMs,a.observedAtMs);assert.equal(g.units[0].socPercent,26);assert.equal(make({...layout,serial:'OTHER'}).knownCount,undefined);assert.equal(make({...layout,onlineCount:2}).knownCount,undefined);now+=86400000;assert.throws(()=>f.snapshot({aioEvidence:{...a,observedAtMs:now},allowAioSiteFallback:true}));
});
test('calm Eco spaces increases but still reduces immediately and never extends a lease while waiting',async()=>{
 const {LocalApiControlSession}=require('../lib/marstek/local-api-control-session');let now=100000,power=0;const writes=[],client={async setTimedPower(p,o){assert(o.valid());power=p;writes.push({p,end:o.endAtMs});return {result:{set_result:true}};},async getMode(){return {result:{mode:'Passive',ongrid_power:power}};},close(){}};
 const c=new LocalApiControlSession({maxChargeW:2500,maxDischargeW:2500},{client,qualified:true,now:()=>now}),s=()=>({gateway:{observedAtMs:now},venus:{observedAtMs:now,deviceMode:'Passive',acDischargeW:power},context:{localApiTimed:true}}),p={controlKind:'eco',reason:'eco-house-support',venusW:500,aioW:0,availableKwh:3};
 try{await c.apply(p,s());const end=c.timed.active.endAtMs;now+=8000;await c.apply({...p,venusW:900},s());assert.equal(power,500);assert.equal(writes.length,1);assert.equal(c.timed.active.endAtMs,end);now+=8000;await c.apply({...p,venusW:200},s());assert.equal(power,200);now+=31000;await c.apply({...p,venusW:900},s());assert.equal(power,900);await c.revoke();assert.equal(power,0);}finally{await c.close();}
});
test('explicit single-AIO site works without a Gateway count and observed multiple membership wins',()=>{
 const {GatewayFeed}=require('../lib/marstek/gateway-feed'),now=100000,f=new GatewayFeed({serial:'GW2412G068',aioSerial:'CH2344G083'},{now:()=>now,client:{},assumeSingleAio:true}),a={singleAio:true,identityVerified:true,serial:'CH2344G083',observedAtMs:now,socPercent:26,acDischargeW:800,gridExportW:0,gridImportW:0,householdLoadW:800,solarW:0};
 const g=f.snapshot({aioEvidence:a,allowAioSiteFallback:true});assert.equal(g.topologyEvidenceSource,'configured-single-aio');assert.equal(g.topologyObservedAtMs,null);assert.equal(g.observedAtMs,now);f.knownCount=2;assert.throws(()=>f.snapshot({aioEvidence:a,allowAioSiteFallback:true}));f.knownCount=1;f.identityFault=true;assert.throws(()=>f.snapshot({aioEvidence:a,allowAioSiteFallback:true}));
});
test('IR1701 zero or a conflicting online count cannot be overwritten by the single-AIO declaration',async()=>{
 const {GatewayFeed}=require('../lib/marstek/gateway-feed'),now=100000;let online=1;const client={async readInputRegisters(base){return {inverterSerial:'GW2412G068',deviceAddress:17,transparentFunction:4,baseRegister:base,requestSentAtMs:now,values:[0,online,0]};}},f=new GatewayFeed({serial:'GW2412G068',aioSerial:'CH2344G083'},{now:()=>now,client,assumeSingleAio:true});
 await f.read(1700,3);assert.equal(f.knownCount,1);online=0;await f.read(1700,3);assert.equal(f.knownCount,null);online=2;await f.read(1700,3);assert.equal(f.knownCount,null);
 const cached=new GatewayFeed({serial:'GW2412G068'},{now:()=>now,client,assumeSingleAio:true,initialTopology:{serial:'GW2412G068',onlineCount:0,units:[]}});assert.equal(cached.knownCount,null);
});
test('collection continuity allows a full bounded grace after a valid paced AIO sample',async t=>{
 const {ShadowService}=require('../lib/marstek/shadow-service');let now=100000,unavailable=false,stops=0;const gateway={observedAtMs:75000,meterObservedAtMs:75000,siteMeterSource:'aio',onlineCount:1},s=new ShadowService({now:()=>now,monotonic:()=>now,periodMs:8000,continuityMs:30000,deadlineMs:45000,readGateway:async()=>unavailable?{unavailable:true}:gateway,readVenus:async()=>({observedAtMs:now,acDischargeW:300}),planProvider:async sample=>{assert.equal(sample.gateway.observedAtMs,75000);return {venusW:300,leaseUntilMs:now+30000,reason:'eco-house-support'};},onUnavailable:async()=>{stops++;}});t.after(()=>s.stop());
 await s.tick();assert.equal(s.lastObservationAt,100000);unavailable=true;now+=8000;await s.tick();assert.equal(stops,0);assert.equal(s.lastResult.request.reason,'observation-delayed');assert.equal(gateway.observedAtMs,75000);now+=23000;await s.tick();await s.stopAction;assert(stops>0);assert.equal(s.lastObservationAt,100000);
});
