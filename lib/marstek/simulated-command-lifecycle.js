'use strict';
// Test-only command abstraction. No sockets, registers or physical adapter.
class SimulatedDevice {
 constructor(id,{ignoreCommands=false,offline=false,stale=false,powerW=0}={}){Object.assign(this,{id,ignoreCommands,offline,stale,powerW});this.telemetryConnected=true;this.commands=[];}
 async command(powerW){this.commands.push(powerW);if(this.offline)throw Error('unreachable');if(!this.ignoreCommands)this.powerW=powerW;return {ack:true};}
 async observe(now){if(this.offline)throw Error('unreachable');return {id:this.id,powerW:this.powerW,observedAtMs:this.stale?now-10000:now};}
}
class SimulatedCommandLifecycle {
 constructor(authority,devices,{now=Date.now,writeTimeoutMs=100}={}){this.authority=authority;this.devices=devices;this.now=now;this.busy=null;this.writeTimeoutMs=writeTimeoutMs;this.uncertain=false;}
 async send(device,powerW){let timer;try{return await Promise.race([device.command(powerW),new Promise((_,reject)=>{timer=setTimeout(()=>{this.uncertain=true;reject(Error('simulated-write-timeout-outcome-unknown'));},this.writeTimeoutMs);})]);}finally{clearTimeout(timer);}}
 async verify(device,powerW,after){try{const observed=await device.observe(this.now());return {id:device.id,verified:observed.id===device.id&&Number.isFinite(observed.powerW)&&Math.abs(observed.powerW-powerW)<=50&&Number.isFinite(observed.observedAtMs)&&observed.observedAtMs>=after&&observed.observedAtMs<=this.now()&&this.now()-observed.observedAtMs<=3000,observed};}catch(error){return {id:device.id,verified:false,error:error.message};}}
 async execute(token,plan){
  if(this.busy||this.stopping)throw Error('Action already in flight');if(!this.authority.allows(token))return {status:'rejected-owner'};
  if(plan.shadowOnly!==true||!Number.isFinite(plan.leaseUntilMs)||plan.leaseUntilMs<=this.now()||plan.leaseUntilMs-this.now()>7000||!Number.isFinite(plan.aioW)||Math.abs(plan.aioW)>6000||!Number.isFinite(plan.venusW)||plan.venusW < -2500||plan.venusW > 800)return {status:'rejected-plan'};
  this.busy=this.perform(token,plan);try{return await this.busy;}finally{this.busy=null;}
 }
 async perform(token,plan){const started=this.now();const written=await Promise.allSettled(this.devices.map((d,i)=>this.send(d,i===0?plan.aioW:plan.venusW)));
  if(!this.authority.allows(token)||this.now()>=plan.leaseUntilMs||written.some(r=>r.status==='rejected'))return this.#stop('revoked-expired-or-command-failure');
  const verification=await Promise.all(this.devices.map((d,i)=>this.verify(d,i===0?plan.aioW:plan.venusW,started)));
  if(!verification.every(r=>r.verified))return this.#stop('power-not-verified');
  this.activeLease=plan.leaseUntilMs;return {status:'simulated-verified',verification,physicalHardwareQualified:false};
 }
 async tick(){if(this.activeLease&&this.now()>=this.activeLease)return this.emergencyStop();return {status:'no-expired-action'};}
 async #stop(reason='emergency-stop'){
  this.activeLease=null;
  this.authority.hold(reason);
  // Revoke first, await any old writes, then zero each peer independently.
  // perform() may enter here itself; external callers should use emergencyStop().
  const started=this.now(),writes=await Promise.allSettled(this.devices.map(d=>this.send(d,0)));
  const verification=await Promise.all(this.devices.map(d=>this.verify(d,0,started)));
  this.authority.hold(reason);
  return {status:!this.uncertain&&verification.every((r,i)=>r.verified&&writes[i].status==='fulfilled')?'simulated-stop-verified':'simulated-stop-partial',reason,verification,uncertainOutstandingWrite:this.uncertain,telemetryConnected:this.devices.every(d=>d.telemetryConnected),physicalHardwareQualified:false};
 }
 emergencyStop(){if(this.stopping)return this.stopping;this.authority.hold('emergency-stop');this.stopping=(async()=>{if(this.busy)await this.busy;return this.#stop('emergency-stop');})();return this.stopping.finally(()=>{this.stopping=null;});}
}
module.exports={SimulatedDevice,SimulatedCommandLifecycle};
