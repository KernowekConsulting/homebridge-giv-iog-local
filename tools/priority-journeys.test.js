'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {SiteCoordinator}=require('../lib/marstek/site-coordinator');
const {ProposalGuard}=require('../lib/marstek/proposal-guard');
const {ControlSession}=require('../lib/marstek/control-session');
const {GatewayFeed}=require('../lib/marstek/gateway-feed');
const {scheduledEvidence}=require('../lib/marstek/priority-policy');
const settings={aioCapacityKwh:13.5,venusCapacityKwh:5.12,aioReserve:20,venusReserve:20,venusInputW:2500,venusOutputW:2500,higherDischargeLimitConfirmed:true};
test('early termination just after a half-hour rounds forwards within the cap; normal endings remain exact',()=>{
 const {earlyTerminationGraceEnd,protectedDispatchEnd}=require('../lib/appliance-integrated-control');
 for(const clock of ['07:00:00.001','07:00:10.000','07:30:00.001','07:30:10.000','07:59:59.999']){
  const now=new Date('2026-11-11T'+clock+'Z'),end=earlyTerminationGraceEnd(now,10);assert(end>now,clock);assert(end-now<=600000);assert.equal(+protectedDispatchEnd(now,30),+now);
 }
 const exact=new Date('2026-11-11T07:30:00.000Z');assert.equal(+earlyTerminationGraceEnd(exact,10),+exact);assert.equal(+earlyTerminationGraceEnd(new Date(+exact+1000),0),+exact+1000);
});
function sample(now=10000){return {nowMs:now,gateway:{unavailable:true},venus:{observedAtMs:now,socPercent:30,acDischargeW:0,acDirectionQualified:true,deviceMode:'Passive'},context:{priorityControlEnabled:true,ecoEnabled:true,overnightEnabled:true,nightActive:true,nightTargetSoc:100,nightEndAtMs:now+21600000,aioEvidence:{observedAtMs:now,identityVerified:true,singleAio:true,socPercent:35,acDischargeW:-2000}}};}
test('scheduled charging survives missing Gateway without pretending a site meter exists',()=>{
 const s=sample(),p=new SiteCoordinator(settings).step(s);assert.equal(p.evidenceKind,'scheduled-battery');assert.equal(p.venusW,-2500);assert.equal(p.aioW,0);assert.equal(p.chargeTargetSoc,100);assert(scheduledEvidence(p,s));
});
test('fresh AIO fallback is rejected for unknown membership, wrong identity, stale evidence and AIO discharge',()=>{
 for(const mutation of [a=>a.identityVerified=false,a=>a.singleAio=false,a=>a.observedAtMs=-30000,a=>a.observedAtMs=10001,a=>a.acDischargeW=800,a=>a.socPercent=NaN]){
  const s=sample();mutation(s.context.aioEvidence);assert.equal(new SiteCoordinator(settings).step(s).venusW,0);
 }
});
test('IOG protection overrides manual export and night charge, including pause and stale Octopus data',()=>{
 for(const mode of ['charge','pauseBoth','pauseCharge','pauseDischarge']){
  const s=sample();s.intent={mode:'export',target:20,deadlineMs:90000};Object.assign(s.context,{iogEnabled:true,iogActive:true,iogFresh:true,iogFetchedAtMs:s.nowMs,iogMode:mode,iogTargetSoc:70,iogEndAtMs:30000});
  const p=new SiteCoordinator(settings).step(s);assert(p.venusW<=0);if(mode==='charge')assert.equal(p.chargeTargetSoc,70);else assert.equal(p.venusW,0);
  s.context.iogFresh=false;assert.equal(new SiteCoordinator(settings).step(s).venusW,0);
 }
});
test('scheduled target and operator holds are enforced independently of combined SOC',()=>{
 const s=sample();s.context.nightTargetSoc=70;s.venus.socPercent=70;s.context.aioEvidence.socPercent=20;
 assert.equal(new SiteCoordinator(settings).step(s).reason,'venus-target-protected');
 for(const key of ['emergencyStop','automationHold','externalOwner']){const q=sample();q.context[key]=true;assert.equal(new SiteCoordinator(settings).step(q).venusW,0);}
});
test('multiple AIOs use qualified Gateway membership; a single AIO cache never substitutes for a pair',()=>{
 const s=sample();s.context.aioEvidence.singleAio=false;
 s.gateway={observedAtMs:s.nowMs,onlineCount:2,units:[{socPercent:40},{socPercent:80}],aioDischargeW:-2000};
 const c=new SiteCoordinator(settings),p=c.step(s);assert.equal(p.venusW,-2500);assert.equal(p.batteryEvidenceSource,'gateway');assert(Math.abs(p.combinedSoc-(60*27+30*5.12)/32.12)<.0001);
 s.gateway={unavailable:true};assert.equal(c.step(s).venusW,0);
});
test('native Modbus charge target changes are written and read back even at unchanged power',async t=>{
 let now=Date.now();const plant=new Plant('modbus',()=>now),session=new ControlSession({maxChargeW:2500,maxDischargeW:2500},{qualified:true,client:plant,now:()=>now});t.after(()=>session.close());const s=sample(now),c=new SiteCoordinator(settings);await session.apply(c.step(s),s);assert.equal(plant.registers[42011],100);
 now+=2000;s.nowMs=s.venus.observedAtMs=s.context.aioEvidence.observedAtMs=now;s.context.nightTargetSoc=70;await session.apply(c.step(s),s);assert.equal(plant.registers[42011],70);assert.equal(session.status,'registers-confirmed');
});
test('expiry during the additional native target readback stops instead of confirming an expired command',async t=>{
 let now=Date.now();const plant=new Plant('modbus',()=>now),read=plant.readHoldingRegisters.bind(plant);plant.readHoldingRegisters=async(a,n)=>{const value=await read(a,n);if(a===42011)now+=6000;return value;};
 const session=new ControlSession({maxChargeW:2500,maxDischargeW:2500},{qualified:true,client:plant,now:()=>now});t.after(()=>session.close());const s=sample(now);await session.apply(new SiteCoordinator(settings).step(s),s);assert.equal(plant.output(),0);assert.equal(session.command,0);assert.equal(session.status,'stop-registers-confirmed');
});
test('unchanged but fresh AIO cache permits Venus lease renewal; unchanged Venus does not authorise an increase',()=>{
 const c=new SiteCoordinator(settings),guard=new ProposalGuard(),s=sample();let p=guard.apply(c.step(s),s);assert.equal(p.venusW,-300);
 s.nowMs+=2000;s.venus.observedAtMs=s.nowMs;p=guard.apply(c.step(s),s);assert.equal(p.venusW,-600);assert.equal(p.leaseUntilMs,s.nowMs+5000);
 s.nowMs+=1000;const held=guard.apply(c.step(s),s);assert.equal(held.venusW,-600);
});
test('recovery clones retain endpoint identity and queue policy',()=>{
 const {DirectLocalReadOnlyClient}=require('../lib/direct-modbus-client');const policy={priority:7};const c=new DirectLocalReadOnlyClient({host:'127.0.0.1',expectedSerial:'GW2412G068',givLeaseOptions:policy});const d=c.cloneForAttempt({enableGracefulContinuity:false});assert.equal(d.expectedSerial,c.expectedSerial);assert.equal(d.givLeaseOptions,policy);
});
test('Gateway background groups retain independent age, reject identity changes and never overlap a collection',async()=>{
 let now=10000,calls=0;const options={host:'127.0.0.1',serial:'GW2412G068'},client={async readInputRegisters(base,count){calls++;const values=Array(count).fill(0);if(base===1700){values[1]=1;values[2]=65536-500;}if(base===1800){values[1]=60;values[16]=65536-500;}if(base===1616){values[0]=65536-100;values[2]=600;}return {inverterSerial:options.serial,deviceAddress:17,transparentFunction:4,baseRegister:base,values};}};
 const feed=new GatewayFeed(options,{client,now:()=>now});await Promise.all([feed.tick(),feed.tick()]);assert.equal(calls,3);assert.equal(feed.knownCount,1);const g=feed.snapshot();assert.equal(g.gridExportW,-100);assert.equal(g.aioDischargeW,500);assert.equal(g.units[0].socPercent,60);
 now+=7000;assert.throws(()=>feed.snapshot(),/stale/);await feed.tick();assert.equal(calls,6);assert(feed.snapshot());
 client.readInputRegisters=async()=>({inverterSerial:'GW9999X999'});await assert.rejects(feed.tick(),/identity/);
});

class Plant{
 constructor(transport,clock){Object.assign(this,{transport,clock,soc:30,power:0,expires:0,registers:{42010:0,42020:0,42021:0,42011:100},writes:[],drop:false});}
 output(){if(this.transport==='api'&&this.clock()>=this.expires)return 0;if(this.power<0&&this.soc>=this.registers[42011])return 0;return this.power;}
 async readHoldingRegisters(a,n){if(this.drop)throw Error('Simulated Venus loss');return Array.from({length:n},(_,i)=>this.registers[a+i]||0);}
 async write(a,v,{valid}){if(this.drop)throw Error('Simulated Venus loss');if(!valid())throw Error('Revoked');this.writes.push([a,v]);this.registers[a]=v;this.power=this.registers[42010]===1?-this.registers[42020]:this.registers[42010]===2?this.registers[42021]:0;}
 async setPower(w,{valid,expiresAtMs}){if(this.drop)throw Error('Simulated Venus loss');if(!valid())throw Error('Revoked');this.power=w;this.expires=Math.min(expiresAtMs,this.clock()+5000);this.writes.push(['api',w]);return {result:{set_result:true}};}
 async getMode(){if(this.drop)throw Error('Simulated Venus loss');return {result:{ongrid_power:this.output(),mode:'Passive'}};}
 close(){}
}
const transports=['modbus'];if(fs.existsSync(require('node:path').join(__dirname,'../lib/marstek/local-api-control-session.js')))transports.push('api');
for(const transport of transports)for(const target of [70,100])test(transport+' accelerated overnight, Gateway outage, IOG amendment, grace and Eco return at target '+target,async t=>{
 let now=Date.now(),aioSoc=33;const plant=new Plant(transport,()=>now),Session=transport==='api'?require('../lib/marstek/local-api-control-session').LocalApiControlSession:ControlSession;
 const session=new Session({maxChargeW:2500,maxDischargeW:2500},{client:plant,qualified:true,now:()=>now});t.after(()=>session.close());
 let c=new SiteCoordinator(settings),guard=new ProposalGuard(),s=sample(now);s.context.nightTargetSoc=target;const end=now+21600000;s.context.nightEndAtMs=end;
 // Two-second virtual steps drive actual command adapters and the device plant.
 // Gateway remains unavailable for this entire six-hour charging window.
 let charged=0;
 for(let n=0;n<10800;n++){
  s.nowMs=now;s.venus={...s.venus,observedAtMs:now,socPercent:plant.soc,acDischargeW:plant.output()};
  if(n%5===0)s.context.aioEvidence={observedAtMs:now,identityVerified:true,singleAio:true,socPercent:aioSoc,acDischargeW:aioSoc<target?-3000:0};
  const plan=guard.apply(c.step(s),s);await session.apply(plan,s);assert(plant.output()<=0);
  const energy=Math.max(0,-plant.output())*2/3600000*.92;charged+=energy;plant.soc=Math.min(target,plant.soc+energy/5.12*100);aioSoc=Math.min(target,aioSoc+3000*2/3600000*.92/13.5*100);now+=2000;
 }
 assert.equal(plant.soc,target);assert.equal(aioSoc,target);assert(charged>0);assert.equal(plant.output(),0);
 // Restart the policy, then simulate EV protection and a shortened/extended slot.
 c=new SiteCoordinator(settings);guard=new ProposalGuard();s.context.nightActive=false;plant.soc=target-5;s.context.iogEnabled=true;s.context.iogActive=true;s.context.iogMode='charge';s.context.iogTargetSoc=target;
 for(let n=0;n<20;n++){
  now+=2000;s.nowMs=now;Object.assign(s.context,{iogFresh:true,iogFetchedAtMs:now,iogEndAtMs:now+(n<10?60000:30000),aioEvidence:{observedAtMs:now,identityVerified:true,singleAio:true,socPercent:target,acDischargeW:0}});s.venus={...s.venus,observedAtMs:now,socPercent:plant.soc,acDischargeW:plant.output()};
  await session.apply(guard.apply(c.step(s),s),s);assert(plant.output()<=0);
 }
 // Existing Octopus interpretation represents protection through grace in the
 // same protected end timestamp; the transport must not discharge during it.
 s.context.iogMode='pauseBoth';now+=2000;s.nowMs=now;s.venus.observedAtMs=now;await session.apply(guard.apply(c.step(s),s),s);assert.equal(plant.output(),0);
 s.context.iogActive=false;s.context.iogFetchedAtMs=now;s.gateway={observedAtMs:now,onlineCount:1,units:[{socPercent:target}],gridExportW:-1000,aioDischargeW:0};s.venus.acDischargeW=0;
 await session.apply(guard.apply(c.step(s),s),s);assert(plant.output()>0);assert(plant.output()<=300);
 await session.revoke();assert.equal(plant.output(),0);
 if(process.env.GIVHOME_SIM_RESULTS)fs.appendFileSync(process.env.GIVHOME_SIM_RESULTS,JSON.stringify({transport,target,simulatedHours:6,gatewayAvailableDuringNight:false,initialAioSoc:33,initialVenusSoc:30,finalAioSoc:aioSoc,finalVenusSoc:target,venusStoredEnergyKwh:charged,ecoReturned:true,scope:'accelerated plant with actual command adapter; not hardware certification'})+'\n');
});
for(const transport of transports)test(transport+' Venus loss does not falsely confirm a stop; recovery reconciles before returning to control',async t=>{
 let now=Date.now();const plant=new Plant(transport,()=>now),Session=transport==='api'?require('../lib/marstek/local-api-control-session').LocalApiControlSession:ControlSession;const session=new Session({maxChargeW:2500,maxDischargeW:2500},{qualified:true,client:plant,now:()=>now});t.after(()=>session.close());const s=sample(now),p=new SiteCoordinator(settings).step(s);await session.apply(p,s);assert(plant.output()<0);plant.drop=true;await session.revoke();assert.equal(session.status,'stop-unconfirmed');plant.drop=false;await session.revoke();assert.equal(plant.output(),0);assert.equal(session.uncertain,false);
});
