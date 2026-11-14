'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {VenusMonitor}=require('../lib/marstek/monitor'),{recoverRead}=require('../lib/marstek/read-continuity');
function blocks(a){if(a===31000){const b=Buffer.alloc(20);b.write('VNSE3-0');return Array.from({length:10},(_,i)=>b.readUInt16BE(i*2));}return ({30200:[144,0,117,0,114],30001:[0],30006:[0],34002:[600],35000:[250],32200:[2400]})[a];}
test('Modbus monitor preserves original transient code for whole-observation recovery, then clears it',async()=>{
 let clients=0;const m=new VenusMonitor({id:'v',staleAfterSeconds:6},{clientFactory:()=>{const n=++clients;return {readHoldingRegisters:async a=>{if(n===1)throw Object.assign(Error('socket refused'),{code:'ECONNREFUSED'});return blocks(a);},close(){}};}});const events=[];
 const sample=await recoverRead(async()=>{await m.pollOnce();const s=m.state();if(!s.sample||s.stale||s.failures){const e=Error('Fresh Venus sample unavailable');e.code=s.failureCode;throw e;}return s.sample.model;},{source:'venus',enabled:true,deadline:performance.now()+3000,onEvent:e=>events.push(e)});
 assert.equal(clients,2);assert.equal(sample.socPercent,60);assert.equal(m.state().failureCode,undefined);assert(events.some(e=>e.phase==='read-recovered'));m.stop();
});
test('invalid Modbus identity is never reclassified as a recoverable network failure',async()=>{
 let calls=0;const m=new VenusMonitor({id:'v',staleAfterSeconds:6},{clientFactory:()=>{calls++;return {readHoldingRegisters:async a=>a===31000?Array(10).fill(0):blocks(a),close(){}};}});
 await assert.rejects(recoverRead(async()=>{await m.pollOnce();const s=m.state();const e=Error(s.lastError);e.code=s.failureCode;throw e;},{source:'venus',enabled:true,deadline:performance.now()+3000}),/Unexpected Marstek model/);assert.equal(calls,1);m.stop();
});
const hasApi=fs.existsSync(path.join(__dirname,'../lib/marstek/local-api-client.js'));
for(const transport of hasApi?['modbus','local-api']:['modbus'])test('actual '+transport+' manager retains its transport-specific observation deadline',async t=>{
 const hap=require('@homebridge/hap-nodejs');class Accessory extends hap.Accessory{constructor(n,id){super(n,id);this.context={};}}
 const {MarstekHomebridge}=require('../lib/marstek/homebridge'),dir=fs.mkdtempSync(path.join(os.tmpdir(),'givhome-wifi-continuity-'));const sim=await (transport==='local-api'?new (require('./local-api-simulator').ApiSimulator)():new (require('./beta-venus-simulator').VenusSim)()).start();
 const config={marstekIntegrationEnabled:true,marstekControlEnabled:false,marstekShadowEnabled:true,marstekSitePreviewEnabled:true,marstekGatewayHost:'127.0.0.1',marstekGatewaySerial:'GW2412G068',marstekShadowBatteryId:'v',marstekAcDischargeSign:'positive',marstekLocalApiPort:sim.port,marstekDevices:[{id:'v',host:'127.0.0.1',port:sim.port}]};
 const api={hap,platformAccessory:Accessory,user:{storagePath:()=>dir},registerPlatformAccessories(){},unregisterPlatformAccessories(){},updatePlatformAccessories(){}};const log=Object.fromEntries(['info','warn','error','debug'].map(k=>[k,()=>{}]));
 const manager=new MarstekHomebridge(log,api,config,{venusTransport:transport,...(transport==='local-api'?{localApiClientFactory:o=>new (require('../lib/marstek/local-api-client').LocalApiClient)({...o,quietMs:0})}:{}),claimEndpoints:()=>()=>{},gatewayReader:async()=>({observedAtMs:Date.now(),onlineCount:1,units:[{socPercent:60}],gridExportW:0,aioDischargeW:0})});
 t.after(async()=>{await manager.stop();await sim.close();fs.rmSync(dir,{recursive:true,force:true});});manager.start();await manager.shadow.inFlight;manager.shadow.stop();assert.equal(manager.shadow.deadlineMs,transport==='local-api'?45000:3000);assert.equal(manager.controlSession,undefined);
});
