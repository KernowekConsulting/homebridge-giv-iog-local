'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const hap=require('@homebridge/hap-nodejs');
const {SiteHomebridge}=require('../lib/marstek/site-homebridge');
const {publish,SocContinuity}=require('../lib/marstek/homekit-continuity');
class Accessory extends hap.Accessory{constructor(n,id){super(n,id);this.context={};}}
function rig(t){
 let now=10000;const dir=fs.mkdtempSync(path.join(os.tmpdir(),'givhome-hap-continuity-')),api={hap,platformAccessory:Accessory,user:{storagePath:()=>dir},registerPlatformAccessories(){},unregisterPlatformAccessories(){}};
 const config={marstekSitePreviewEnabled:true,marstekGatewaySerial:'GW2412G068',marstekShadowBatteryId:'v',marstekDevices:[{id:'v',host:'127.0.0.1'}]};let invalidations=0;
 const make=()=>{const ui=new SiteHomebridge({},api,config,{now:()=>now,onInvalidate:()=>invalidations++});ui.start();return ui;};
 const ui=make(),s={nowMs:now,gateway:{observedAtMs:now,onlineCount:1,units:[{socPercent:70}],gridExportW:100,aioDischargeW:0},venus:{observedAtMs:now,socPercent:70,acDischargeW:0,acDirectionQualified:true},context:{ecoEnabled:true}};
 t.after(()=>{ui.stop();fs.rmSync(dir,{recursive:true,force:true});});
 return {ui,s,make,advance:ms=>now+=ms,invalidations:()=>invalidations,tick:(ms=2000)=>{now+=ms;s.nowMs=now;if(!s.gateway.unavailable)s.gateway.observedAtMs=now;s.venus.observedAtMs=now;return ui.sample(s);}};
}
test('SOC uses a bounded last verified value without manufacturing fresh timestamps or publishing Off',async t=>{
 const r=rig(t);r.tick();const on=r.ui.tiles.soc.on,level=r.ui.tiles.soc.level;assert.equal(await on.handleGetRequest(),true);assert.equal(await level.handleGetRequest(),70);
 r.advance(80000);r.s.gateway={unavailable:true};r.tick(0);assert.equal(await level.handleGetRequest(),70);assert.equal(await on.handleGetRequest(),true);
 r.advance(11000);r.ui.refresh();await assert.rejects(level.handleGetRequest());await assert.rejects(on.handleGetRequest());assert.notEqual(on.value,false);
});
test('identity change invalidates display immediately instead of retaining a plausible percentage',t=>{
 const r=rig(t);r.tick();assert.equal(r.ui.socLevel(),70);r.s.gateway.identityFault=true;r.tick();assert.equal(r.ui.socLevel(),null);assert.equal(r.ui.state.intent,null);
});
test('same-value recovery sends an explicit HAP event and clears the communication status',async()=>{
 const c=new hap.Characteristic.Brightness(),events=[];c.on('change',e=>events.push(e));publish(c,90);publish(c,new hap.HapStatusError(hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE));assert.notEqual(c.statusCode,0);publish(c,90);assert.equal(c.statusCode,0);assert(events.some(e=>e.reason==='event'&&e.newValue===90));
});
for(const mode of ['charge','export'])test(mode+' request survives a short data gap with zero output, then resumes only after advancing fresh pairs',async t=>{
 const r=rig(t);r.tick();await r.ui.tiles[mode].level.handleSetRequest(mode==='charge'?80:53);await r.ui.tiles[mode].on.handleSetRequest(true);r.tick();r.s.gateway={unavailable:true};const paused=r.tick();assert.equal(paused.aioW,0);assert.equal(paused.venusW,0);assert.equal(r.ui.state.intent.mode,mode);assert(r.ui.pending);assert.equal(await r.ui.tiles[mode].on.handleGetRequest(),true);
 r.s.gateway={observedAtMs:r.s.nowMs,onlineCount:1,units:[{socPercent:70}],gridExportW:100,aioDischargeW:0};
 for(let n=0;n<3;n++){const p=r.tick();assert.equal(p.aioW,0);assert.equal(p.venusW,0);}
 const resumed=r.tick();assert.equal(r.ui.pending,null);assert.equal(r.ui.state.intent.mode,mode);assert(mode==='export'?resumed.aioW>0:resumed.aioW<0);
});
test('Off during pending recovery is final, and later readings never rearm the export',async t=>{
 const r=rig(t);r.tick();await r.ui.tiles.export.on.handleSetRequest(true);r.s.gateway={unavailable:true};r.tick();await r.ui.tiles.export.on.handleSetRequest(false);assert.equal(r.ui.pending,null);r.s.gateway={observedAtMs:r.s.nowMs,onlineCount:1,units:[{socPercent:70}],gridExportW:0,aioDischargeW:0};for(let n=0;n<8;n++)r.tick();assert.equal(r.ui.state.intent,null);assert.equal(r.ui.tiles.export.on.value,false);
});
test('a request waiting longer than thirty seconds expires without later resurrection',async t=>{
 const r=rig(t);r.tick();await r.ui.tiles.export.on.handleSetRequest(true);r.s.gateway={unavailable:true};r.tick();r.advance(31000);r.tick(0);assert.equal(r.ui.state.intent,null);assert.equal(r.ui.pending,null);assert.equal(r.ui.tiles.export.on.value,false);
});
test('repeated or intermittent observations cannot qualify a pending export for recovery',async t=>{
 const r=rig(t);r.tick();await r.ui.tiles.export.on.handleSetRequest(true);r.s.gateway={unavailable:true};r.tick();r.s.gateway={observedAtMs:r.s.nowMs,onlineCount:1,units:[{socPercent:70}],gridExportW:0,aioDischargeW:0};r.tick();for(let n=0;n<4;n++){r.advance(1000);r.s.nowMs+=1000;assert.equal(r.ui.sample(r.s).aioW,0);}assert(r.ui.pending);
 r.tick(7000);assert(r.ui.pending);assert.equal(r.ui.pending.count,1);
});
for(const order of ['on-first','level-first'])test('stale but recently verified request accepts dimmer '+order+' ordering without a network wait',async t=>{
 const r=rig(t);r.tick();r.s.gateway={unavailable:true};r.tick();const tile=r.ui.tiles.export;
 if(order==='on-first'){await tile.on.handleSetRequest(true);await tile.level.handleSetRequest(53);}else{await tile.level.handleSetRequest(53);await tile.on.handleSetRequest(true);}
 assert.equal(r.ui.state.intent.mode,'export');assert.equal(r.ui.state.intent.target,53);assert(r.ui.pending);assert.equal(tile.on.value,true);
});
test('restart discards a pending manual export but permits default Eco recovery',async t=>{
 const r=rig(t);r.tick();await r.ui.tiles.export.on.handleSetRequest(true);r.s.gateway={unavailable:true};r.tick();r.ui.stop();const restarted=r.make();t.after(()=>restarted.stop());assert.equal(restarted.state.intent,null);assert.equal(restarted.authority.state.hold,'telemetry-stale');
});
test('a hard stop fault during pending recovery cannot be downgraded to a transient hold',async t=>{
 const r=rig(t);r.tick();await r.ui.tiles.export.on.handleSetRequest(true);r.s.gateway={unavailable:true};r.tick();r.ui.authority.hold('stop-unconfirmed');r.ui.state.cancel();r.advance(31000);r.tick(0);assert.equal(r.ui.pending,null);assert.equal(r.ui.authority.state.hold,'stop-unconfirmed');assert.equal(r.ui.state.intent,null);
});
test('display continuity does not rewrite source age when the same value is republished',()=>{
 const d=new SocContinuity();const s={nowMs:1000,gateway:{observedAtMs:1000},venus:{observedAtMs:1000}};d.observe({result:{combinedSoc:90}},s);s.nowMs=80000;d.observe({result:{combinedSoc:90}},s);assert.equal(d.value(90000),90);assert.equal(d.value(92000),null);
});
test('decision-time Gateway cache refresh uses a newer observation without another hardware read',async()=>{
 const {ShadowService}=require('../lib/marstek/shadow-service');let reads=0,seen;const service=new ShadowService({readGateway:async()=>{reads++;return {observedAtMs:1000};},readVenus:async()=>({observedAtMs:5000}),refreshGateway:()=>({observedAtMs:5000}),planProvider:async sample=>{seen=sample;return {venusW:0,leaseUntilMs:Date.now(),reason:'idle'};}});await service.tick();service.stop();assert.equal(reads,1);assert.equal(seen.gateway.observedAtMs,5000);
});
