'use strict';
const {CommandClient}=require('./command-client');
class ControlSession {
 constructor(device,{qualified=false,now=Date.now,client=new CommandClient(device),checkpoint=()=>{},onEvidence=()=>{}}={}){Object.assign(this,{device,qualified,now,client,checkpoint,onEvidence});this.generation=0;this.command=0;this.chargeTarget=null;this.activeAttempt=false;this.externalHeld=false;this.uncertain=false;this.status=qualified?'idle':'commissioning-required';this.tail=Promise.resolve();this.stopped=false;this.lease=0;this.lastClock=this.now();this.watchdogPending=false;this.timer=setInterval(()=>{const clock=this.now(),backwards=clock<this.lastClock;this.lastClock=clock;if(this.qualified&&!this.stopped&&this.lease&&(clock>=this.lease||backwards)&&!this.watchdogPending){this.lease=0;this.watchdogPending=true;this.revoke(backwards?'clock-regression':'lease-expired').finally(()=>{this.watchdogPending=false;}).catch(()=>{});}},250);this.timer.unref?.();}
 evidence(e){try{this.onEvidence({at:this.now(),...e});}catch{}}
 revoke(reason='revoked'){this.generation++;return this.enqueue(()=>this.stop(reason));}
 enqueue(fn){const next=this.tail.then(fn);this.tail=next.catch(()=>{});return next;}
 apply(plan,{gateway,venus,context={},tokenValid=()=>true}={}){
  const generation=this.generation;
  this.lease=Number.isFinite(plan?.leaseUntilMs)?plan.leaseUntilMs:0;
  return this.enqueue(async()=>{
   if(!this.qualified||this.stopped||this.externalHeld)return {status:this.status};
   const valid=()=>generation===this.generation&&!this.stopped&&tokenValid()&&Number.isFinite(plan?.leaseUntilMs)&&this.now()<plan.leaseUntilMs;
   const fresh=plan?.evidenceKind==='scheduled-battery'?require('./priority-policy').scheduledEvidence(plan,{gateway,venus,context,nowMs:this.now()}):[gateway,venus].every(x=>x&&Number.isFinite(x.observedAtMs)&&x.observedAtMs<=this.now()&&this.now()-x.observedAtMs<6000);
   let desired=valid()&&fresh&&Number.isFinite(plan.venusW)?Math.trunc(plan.venusW/50)*50:0;
   if(desired>0)desired=Math.min(desired,this.device.maxDischargeW);else desired=-Math.min(-desired,this.device.maxChargeW);
   if(venus?.chargeAllowed===false&&desired<0||venus?.dischargeAllowed===false&&desired>0)desired=0;
   if(!desired||this.uncertain||!valid()){await this.stop(plan?.reason||'invalid-plan');return {status:this.status};}
   try{
    if(desired!==this.command||desired<0&&this.chargeTarget!==(plan.chargeTargetSoc??100)){
     if(this.command*desired>0&&!this.uncertain){
      const mode=await this.client.readHoldingRegisters(42010,1),power=await this.client.readHoldingRegisters(desired<0?42020:42021,1);
      if(mode[0]!== (desired<0?1:2)||power[0]!==Math.abs(this.command)){this.externalHeld=true;this.command=0;this.activeAttempt=false;this.checkpoint(null);return {status:this.status='external-control-owner'};}
      // Retain the running direction when only its setpoint changes.
      this.checkpoint({active:true,requestedW:desired});
      if(desired<0&&this.chargeTarget!==(plan.chargeTargetSoc??100))await this.client.write(42011,plan.chargeTargetSoc??100,{valid});
      await this.client.write(desired<0?42020:42021,Math.abs(desired),{valid});
     }else{if(!this.command&&!this.uncertain&&!this.activeAttempt){const mode=await this.client.readHoldingRegisters(42010,1);if(mode[0]!==0){this.externalHeld=true;return {status:this.status='external-control-owner'};}}this.activeAttempt=true;await this.stop();if(this.uncertain||!valid())return {status:this.status};
     // Never reverse against measured power. Wait for a later fresh observation.
     if(desired*venus.acDischargeW<0&&Math.abs(venus.acDischargeW)>50)return {status:this.status='waiting-for-zero'};
     this.checkpoint({active:true,requestedW:desired});this.activeAttempt=true;
     for(const [a,v] of [[42000,21930],[42011,desired<0?(plan.chargeTargetSoc??100):20],[desired<0?42020:42021,Math.abs(desired)],[42010,desired<0?1:2]]){if(!valid())throw Error('Control revoked');await this.client.write(a,v,{valid});}
     }
    }
    const mode=await this.client.readHoldingRegisters(42010,1),power=await this.client.readHoldingRegisters(desired<0?42020:42021,1);
    if(!valid())throw Error('Control expired during readback');
    if(mode[0]!== (desired<0?1:2)||power[0]!==Math.abs(desired)){this.externalHeld=true;this.command=0;this.activeAttempt=false;this.checkpoint(null);return {status:this.status='external-control-owner'};}
    if(desired<0){const target=await this.client.readHoldingRegisters(42011,1);if(target[0]!== (plan.chargeTargetSoc??100))throw Error('Venus charge target readback mismatch');this.chargeTarget=target[0];}
    if(!valid())throw Error('Control expired during target readback');
    this.command=desired;return {status:this.status='registers-confirmed',requestedW:desired,effectConfirmed:Math.sign(venus.acDischargeW)===Math.sign(desired)&&Math.abs(venus.acDischargeW)>50};
   }catch(error){this.uncertain=true;this.status='command-uncertain';await this.stop();return {status:this.status,error:error.message};}
  });
 }
 async stop(reason='transition'){
  if(!this.qualified||this.stopped)return;
  if(this.externalHeld||(!this.command&&!this.uncertain&&!this.activeAttempt))return;
  this.evidence({phase:'venus-stop-requested',reason,requestedW:this.command});
  try{for(const a of [42010,42020,42021])await this.client.write(a,0,{valid:()=>!this.stopped,priority:100});const mode=await this.client.readHoldingRegisters(42010,1),p=await this.client.readHoldingRegisters(42020,2);if(mode[0]||p.some(Boolean))throw Error('Venus stop readback mismatch');this.command=0;this.activeAttempt=false;this.checkpoint(null);this.uncertain=false;this.status='stop-registers-confirmed';this.evidence({phase:'venus-stop-result',reason,status:this.status});}catch(error){this.uncertain=true;this.status='stop-unconfirmed';this.evidence({phase:'venus-stop-result',reason,status:this.status,error:error.message});}
 }
 async close(){clearInterval(this.timer);this.generation++;await this.enqueue(()=>this.stop());this.stopped=true;this.client.close();}
}
// Loopback fixtures may operate without a certificate. Physical devices require
// successful commissioning and a fresh matching identity in the plugin manager.
function qualifiedBinding(device){return device.host==='127.0.0.1'&&device.port>=1024;}
module.exports={ControlSession,qualifiedBinding};
