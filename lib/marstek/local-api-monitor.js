'use strict';
const {EventEmitter}=require('node:events');
const {LocalApiClient}=require('./local-api-client');
function identity(reply){const r=reply.result,mac=String(r.ble_mac||'').replace(/[:-]/g,'').toLowerCase();if(!/^(?:venus[ _-]*e(?:[ ._-]*3(?:\.0)?)?|vnse3-0)$/i.test(String(r.device||''))||!/^[a-f0-9]{12}$/.test(mac)||/^(0{12}|f{12})$/.test(mac)||!['string','number'].includes(typeof r.ver)||!String(r.ver)||typeof r.ver==='number'&&!Number.isFinite(r.ver))throw Error('Unqualified Venus Local API identity');return {model:r.device,mac:mac.match(/../g).join(':'),firmware:{api:String(r.ver)},src:reply.src};}
function mode(value){if(['Auto','AI','Manual','Passive','UPS','Ups'].includes(value))return value==='Ups'?'UPS':value;if(Number.isInteger(value)&&value>=0&&value<=4)return ['Auto','AI','Manual','Passive','UPS'][value];throw Error('Unknown Venus Local API mode');}
function decode(reply,binding,identityAtMs,observedAtMs){const r=reply.result,soc=r.bat_soc,ac=r.ongrid_power;if(!Number.isFinite(soc)||soc<0||soc>100||!Number.isFinite(ac)||Math.abs(ac)>3000)throw Error('Invalid Venus Local API power or SOC');return {profile:'venus-local-api-rev3.1.2',deviceName:binding.model,firmware:{display:binding.firmware.api},binding,identityAtMs,observedAtMs,socPercent:soc,acSignedW:ac,deviceMode:mode(r.mode),powerBasis:'ac',chargePowerW:Math.max(0,-ac),dischargePowerW:Math.max(0,ac),charging:ac< -50,discharging:ac>50,temperatureC:null,acVoltageV:null};}
class LocalApiMonitor extends EventEmitter{
 constructor(device,{port=30000,clientFactory=options=>new LocalApiClient(options),readTimeoutMs,now=Date.now}={}){super();Object.assign(this,{config:device,now,readTimeoutMs});this.client=clientFactory({host:device.host,port});this.sample=null;this.binding=null;this.identityAtMs=0;this.failures=0;this.lastError='';this.running=false;}
 seedIdentity(binding,at){if(!binding||!Number.isFinite(at)||at>this.now()||this.now()-at>6000)throw Error('Fresh API identity required');this.binding=binding;this.identityAtMs=at;}
 state(){const ageMs=this.sample?Math.max(0,this.now()-this.sample.model.observedAtMs):null,stale=ageMs===null||ageMs>=this.config.staleAfterSeconds*1000;return {sample:this.sample,ageMs,stale,failures:this.failures,lastError:this.lastError,failureCode:this.lastException?.code,status:!this.sample?'starting':stale?'stale':this.failures?'retrying':'online'};}
 pollOnce(){if(this.inFlight)return this.inFlight;this.inFlight=this.read().finally(()=>{this.inFlight=null;});return this.inFlight;}
 async read(){try{if(!this.binding||this.now()-this.identityAtMs>=30000){const started=this.now(),reply=await this.client.getDevice({timeoutMs:this.readTimeoutMs});const binding=identity(reply);if(this.binding&&JSON.stringify(binding)!==JSON.stringify(this.binding))throw Error('Venus Local API identity changed');this.binding=binding;this.identityAtMs=reply.sentAtMs??started;}
  const started=this.now(),reply=await this.client.getMode({timeoutMs:this.readTimeoutMs});this.sample={model:{...decode(reply,this.binding,this.identityAtMs,reply.sentAtMs??started),requestQuietMs:this.client.session?.quietMs??2000},raw:reply.result};this.failures=0;this.lastError='';
 }catch(error){this.failures++;this.lastError=error.message;this.lastException=error;}this.emit('state',this.state());return this.state();}
 start(){if(this.running)return;this.running=true;void this.cycle();}
 async cycle(){await this.pollOnce();if(this.running){this.timer=setTimeout(()=>this.cycle(),this.failures?5000:this.config.pollIntervalSeconds*1000);this.timer.unref?.();}}
 pause(){this.running=false;clearTimeout(this.timer);}
 stop(){this.pause();this.client.close();}
}
module.exports={LocalApiMonitor,identity,decode,mode};
