'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const hap=require('@homebridge/hap-nodejs');
const {ApiSimulator}=require('./local-api-simulator'),{LocalApiClient}=require('../lib/marstek/local-api-client'),{LocalApiMonitor}=require('../lib/marstek/local-api-monitor'),{LocalApiControlSession}=require('../lib/marstek/local-api-control-session'),{ShadowService}=require('../lib/marstek/shadow-service'),{SiteHomebridge}=require('../lib/marstek/site-homebridge');
class Accessory extends hap.Accessory{constructor(n,id){super(n,id);this.context={};}}
test('production paced API: HomeKit charge/export, a lost reply, completion, Off, night and amended IOG',{timeout:240000},async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'givhome-reliable-')),sim=await new ApiSimulator().start(),original=sim.receive.bind(sim);let lost=0,aioSoc=60,aioW=0,gAt;
 sim.receive=(data,peer)=>{if(JSON.parse(data).method==='ES.GetMode'&&lost){lost--;return;}original(data,peer);};
 const client=new LocalApiClient({host:'127.0.0.1',port:sim.port}),monitor=new LocalApiMonitor({host:'127.0.0.1',pollIntervalSeconds:8,staleAfterSeconds:30},{port:sim.port,readTimeoutMs:15000}),session=new LocalApiControlSession({maxChargeW:2500,maxDischargeW:800},{client,qualified:true});
 const c={localApiTimed:true,priorityControlEnabled:true,ecoEnabled:true,cooperativeCharge:true};
 const api={hap,platformAccessory:Accessory,user:{storagePath:()=>dir},registerPlatformAccessories(){},unregisterPlatformAccessories(){}};
 const config={marstekTimedApi:true,marstekSitePreviewEnabled:true,marstekGatewaySerial:'GW2412G068',marstekShadowBatteryId:'v',marstekDevices:[{id:'v',host:'127.0.0.1'}]};
 const ui=new SiteHomebridge({},api,config,{onInvalidate:()=>{void session.revoke();}});ui.start();let stops=0;
 const gateway=()=>({observedAtMs:gAt??Date.now(),onlineCount:1,units:[{socPercent:aioSoc}],aioDischargeW:aioW,gridExportW:-1000});
 const readVenus=async()=>{await monitor.pollOnce();const s=monitor.state();if(s.failures||s.stale){throw Object.assign(Error(s.lastError),{code:s.failureCode});}const m=s.sample.model;return {observedAtMs:m.observedAtMs,socPercent:m.socPercent,acDischargeW:m.acSignedW,acDirectionQualified:true,identityQualified:true,deviceMode:m.deviceMode};};
 const service=new ShadowService({periodMs:8000,deadlineMs:45000,continuityMs:30000,readRecovery:true,readGateway:async()=>gateway(),readVenus,contextProvider:()=>c,onUnavailable:async()=>{stops++;ui.pauseIntent('telemetry-unavailable');await session.revoke();return {venus:{wasActive:true}};},planProvider:async sample=>{const p=ui.sample(sample),generation=ui.authority.state.generation;await session.apply(p,{...sample,tokenValid:()=>generation===ui.authority.state.generation&&!ui.authority.state.hold});return p;}});
 let lastCycle=0;const tick=async()=>{const delay=Math.max(0,lastCycle+8000-Date.now());if(delay)await new Promise(r=>setTimeout(r,delay));lastCycle=Date.now();await service.tick();};
 t.after(async()=>{service.stop();ui.stop();await session.close();monitor.stop();await sim.close();fs.rmSync(dir,{recursive:true,force:true});});
 await tick();await ui.tiles.charge.level.handleSetRequest(70);await ui.tiles.charge.on.handleSetRequest(true);await tick();await tick();assert(sim.output()<0,JSON.stringify({status:session.status,plan:service.lastResult,intent:ui.state.intent,authority:ui.authority.state,writes:sim.requests.filter(q=>q.method==='ES.SetMode')}));
 lost=1;await tick();assert.equal(ui.state.intent?.mode,'charge','One lost reply must not cancel the target');assert.equal(stops,0);assert(service.lastResult.request.readEvidence.some(e=>e.phase==='read-recovered'));await tick();assert(sim.output()<0);
 aioSoc=80;sim.soc=80;await tick();assert.equal(ui.state.intent,null);assert.equal(sim.output(),0,'Combined target completion must stop physical output');
 c.cooperativeCharge=false;await ui.tiles.export.level.handleSetRequest(70);await ui.tiles.export.on.handleSetRequest(true);await tick();assert(sim.output()>0,'Export To must use available Venus headroom');gAt=Date.now();await tick();await tick();assert(sim.output()>0,'Guarded fresh-pair status must stay on timed action path');gAt=undefined;
 await ui.tiles.export.on.handleSetRequest(false);await session.tail;assert.equal(sim.output(),0);assert.equal(ui.state.intent,null);
 // A subsequent explicit action clears manual cancellation; this test then exercises scheduled source transitions.
 ui.authority.begin('test-scheduled-window',Date.now());ui.authority.finish();aioSoc=60;sim.soc=60;Object.assign(c,{overnightEnabled:true,nightActive:true,nightTargetSoc:100,nightEndAtMs:Date.now()+300000});await tick();await tick();assert(sim.output()<0,'Night charge must start');
 Object.assign(c,{nightActive:false,iogEnabled:true,iogActive:true,iogFresh:true,iogFetchedAtMs:Date.now(),iogFreshForMs:120000,iogMode:'charge',iogTargetSoc:100,iogEndAtMs:Date.now()+45000});await tick();assert(sim.output()<0);assert(sim.expires<=c.iogEndAtMs+1000,'Amended IOG end must bound native countdown');
 Object.assign(c,{iogMode:'pauseBoth',iogFetchedAtMs:Date.now()});await tick();assert.equal(sim.output(),0,'Pause/grace policy must stop output');
 assert(sim.requests.filter(q=>q.method==='ES.SetMode'&&q.params.config.passive_cfg.power).every(q=>q.params.config.passive_cfg.cd_time>5),'No legacy five-second writes');
});
