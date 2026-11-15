'use strict';
// Delivery, direction and achieved rate are different pieces of evidence.
function assess(power,observedW,at,startedAt){
 const toleranceW=Math.max(30,Math.abs(power)*.2),confirmed=(power===0||Math.sign(observedW)===Math.sign(power))&&Math.abs(observedW-power)<=toleranceW;
 return {requestedW:power,observedW,observedAtMs:at,toleranceW,confirmed,state:power&&Math.abs(observedW)>30&&Math.sign(observedW)!==Math.sign(power)?'opposite-direction':confirmed?'at-requested':at-startedAt<20000?'settling':'below-requested',fraction:power?Math.abs(observedW/power):null};
}
class TimedAction {
 constructor(client,{now=Date.now,sleep=ms=>new Promise(r=>setTimeout(r,ms)),checkpoint=()=>{}}={}){Object.assign(this,{client,now,sleep,checkpoint});this.active=null;this.generation=0;}
 save(){const a=this.active;if(a)this.checkpoint({transport:'local-api',active:true,requestedW:a.power,endAtMs:a.endAtMs,requestedAtMs:a.requestedAtMs,acknowledged:a.acknowledged,deliveryEvidence:a.deliveryEvidence,rate:a.rate,battery:this.rateContext});}
 observe(sample){const a=this.active,at=sample?.observedAtMs,w=sample?.acDischargeW,now=this.now();if(!a||sample?.deviceMode!=='Passive'||!Number.isFinite(at)||at<a.requestedAtMs||at>now||now-at>30000||now>=a.endAtMs||a.rate&&at<=a.rate.observedAtMs||!Number.isFinite(w)||Math.abs(w)>3000)return null;a.rate=assess(a.power,w,at,a.rateStartedAtMs??a.requestedAtMs);this.save();return a.rate;}
 async set(power,endAtMs,{valid=()=>true,baselineW,reuseReadback=false}={}){
  if(!Number.isInteger(power)||Math.abs(power)>2500||!Number.isFinite(endAtMs)||endAtMs<=this.now()||endAtMs-this.now()>300000)throw Error('Invalid timed action');
  const generation=++this.generation,allowed=()=>generation===this.generation&&valid()&&this.now()<endAtMs;
  this.checkpoint({transport:'local-api',active:true,requestedW:power,endAtMs});
  for(let attempt=0;attempt<3&&allowed();attempt++){
   const remaining=Math.floor((endAtMs-this.now())/1000);if(remaining<1)break;
   let acknowledged=false,rejected=false,sentAt=this.now();
   let pair;
   try{
    if(this.client.timedPowerExchange)pair=await this.client.timedPowerExchange(power,{endAtMs,valid:allowed,reuseReadback});
    if(pair?.writeError)throw pair.writeError;
    const r=pair?pair.reply:await this.client.setTimedPower(power,{endAtMs,valid:allowed});
    sentAt=r.sentAtMs??sentAt;acknowledged=r.result.set_result===true;rejected=!acknowledged;
   }catch(error){sentAt=error.sentAtMs??sentAt;rejected=error.apiCode!==undefined;if(!allowed())break;}
   if(!allowed())break;
   try{const r=pair?pair.readback:await this.client.getMode({valid:allowed,expiresAtMs:endAtMs,timeoutMs:15000,priority:power===0?100:10});if(!allowed())break;if(!r)throw Error('Timed readback unavailable');const w=r.result.ongrid_power,at=r.sentAtMs??this.now();
    if(r.result.mode==='Passive'&&Number.isFinite(w)&&Math.abs(w)<=3000&&(power===0?Math.abs(w)<=30:Math.sign(w)===Math.sign(power)&&Math.abs(w)>=30)){
     const rateStartedAtMs=this.active?.power===power&&this.active.endAtMs>this.now()?(this.active.rateStartedAtMs??this.active.requestedAtMs):sentAt,rate=assess(power,w,at,rateStartedAtMs),cfg=r.result.passive_cfg||r.result.config?.passive_cfg;
     const readback=cfg?.power===power&&Number.isFinite(cfg.cd_time)&&cfg.cd_time>0&&Math.abs(cfg.cd_time*1000-(endAtMs-at))<=2000;
     const changed=Number.isFinite(baselineW)&&Math.abs(baselineW-power)>rate.toleranceW&&rate.confirmed;
     // An old 810 W observation cannot turn a lost/rejected 2500 W write into success.
     if(power===0||!rejected&&(acknowledged||readback||changed)){
      this.active={power,endAtMs,requestedAtMs:sentAt,rateStartedAtMs,acknowledged,deliveryEvidence:acknowledged?'acknowledged':readback?'setpoint-readback':power===0?'measured-zero':'measured-rate-change',rate};this.save();return {status:rate.confirmed?'effect-confirmed':rate.state==='settling'?'rate-pending':'rate-limited',observedW:w,requestedW:power,acknowledged,deliveryEvidence:this.active.deliveryEvidence,rate,attempts:attempt+1,endAtMs};
     }
    }
   }catch(error){if(!allowed())break;}
   await this.sleep(Math.min(1500*2**attempt,Math.max(0,endAtMs-this.now())));
  }
  throw Error('Timed action effect unconfirmed or revoked');
 }
 async stop(){this.generation++;const result=await this.set(0,this.now()+65000);this.active=null;this.checkpoint(null);return result;}
}
module.exports={TimedAction};
