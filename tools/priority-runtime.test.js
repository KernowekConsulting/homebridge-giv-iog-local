'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {fixture}=require('./control-test-fixture'),{VenusSim}=require('./beta-venus-simulator');
const {MarstekHomebridge}=require('../lib/marstek/homebridge'),{SiteHomebridge}=require('../lib/marstek/site-homebridge');
const hap=require('@homebridge/hap-nodejs');
class Accessory extends hap.Accessory{constructor(n,id){super(n,id);this.context={};}}
const log=Object.fromEntries(['info','warn','debug','error'].map(k=>[k,()=>{}]));
const transports=['modbus'];if(fs.existsSync(path.join(__dirname,'../lib/marstek/local-api-client.js')))transports.push('local-api');
for(const transport of transports)test(transport+' actual managers use AIO protection and cached telemetry during Gateway loss, then return to Eco',async t=>{
 const f=fixture(t,{config:{marstekIntegrationEnabled:true,enableCheapOvernightCharging:false,enableOctopusSmartWindows:true,octopusApiKey:'simulation',octopusAccountNumber:'simulation',enableEvSmartWindowBatteryProtection:true,iogHomeBatteryProtectionMode:'charge',iogChargeTargetSoc:70,graceMinutes:10}});
 const isApi=transport==='local-api',sim=await (isApi?new (require('./local-api-simulator').ApiSimulator)():new VenusSim({responseTauMs:100})).start();
 const config={marstekIntegrationEnabled:true,marstekControlEnabled:true,marstekShadowEnabled:true,marstekSitePreviewEnabled:true,marstekGatewayHost:'127.0.0.1',marstekGatewaySerial:'GW2412G068',marstekShadowBatteryId:'v',marstekAcDischargeSign:'positive',marstekLocalApiPort:sim.port,marstekDevices:[{id:'v',host:'127.0.0.1',port:sim.port}]};
 const api={hap,platformAccessory:Accessory,user:{storagePath:()=>f.directory},registerPlatformAccessories(){},unregisterPlatformAccessories(){},updatePlatformAccessories(){}};
 const ui=new SiteHomebridge(log,api,config),context=now=>({...f.p.marstekPolicyContext(now),priorityControlEnabled:true,aioEvidence:{observedAtMs:now,identityVerified:true,singleAio:true,socPercent:60,acDischargeW:f.registers[96]===1?-3000:0},iogFresh:true,iogFetchedAtMs:now});ui.start();let missing=false;
 const manager=new MarstekHomebridge(log,api,config,{...(isApi?{venusTransport:transport,localApiClientFactory:o=>new (require('../lib/marstek/local-api-client').LocalApiClient)({...o,quietMs:0})}:{}),claimEndpoints:()=>()=>{},contextProvider:context,gatewayReader:async()=>{if(missing)throw Error('Simulated Gateway loss');return {observedAtMs:Date.now(),onlineCount:1,units:[{socPercent:60}],gridExportW:-1000,aioDischargeW:0};},onSample:s=>ui.sample(s)});
 manager.start();await manager.shadow.inFlight;manager.shadow.stop();
 t.after(async()=>{ui.stop();await manager.stop();await sim.close();});
 const tick=async()=>{t.mock.timers.tick(2000);if(!isApi)sim.tick(2000);await manager.shadow.tick();};
 await tick();assert((isApi?sim.output():sim.demand)>0,'Eco must initially serve load');
 const now=Date.now();f.p.octopusState.dispatches=[{start:new Date(now-1000),end:new Date(now+60000)}];await f.p.applyApplianceAutomation();assert.equal(f.registers[96],1,'Established AIO path must charge');missing=true;
 for(let n=0;n<3;n++)await tick();assert((isApi?sim.output():sim.demand)<0,'Venus must charge without Gateway');assert.equal(ui.latest.result.evidenceKind,'scheduled-battery');
 // Target completion is individual; the AIO remains owned by its established
 // charging lifecycle rather than being released by the Venus target.
 sim.soc=70;await tick();assert.equal(isApi?sim.output():sim.demand,0);assert.equal(f.registers[96],1);
 const early=new Date(Date.now());f.p.octopusState.earlyTerminationGraceUntil=require('../lib/appliance-integrated-control').earlyTerminationGraceEnd(early,10);f.p.octopusState.earlyTerminationDispatchStart=new Date(now-1000);f.p.octopusState.earlyTerminationDispatchEnd=new Date(now+60000);f.p.octopusState.dispatches=[];await f.p.applyApplianceAutomation();assert.equal(f.p.currentCheapStateForStatusTiles().graceActive,true,JSON.stringify({now:new Date(),state:f.p.octopusState,cheap:f.p.currentCheapStateForStatusTiles()}));await tick();assert.equal(isApi?sim.output():sim.demand,0,'Grace must retain Venus protection');assert.equal(f.registers[96],1,'AIO grace must remain acquired');
 t.mock.timers.tick(660000);await f.p.applyApplianceAutomation();missing=false;
 for(let n=0;n<3;n++)await tick();assert.equal(context(Date.now()).iogActive,false);assert((isApi?sim.output():sim.demand)>0,'Eco must return after protected period');
});
