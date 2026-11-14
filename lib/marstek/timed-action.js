'use strict';
// One bounded action; retry delivery, never extend the original device deadline.
class TimedAction {
 constructor(client,{now=Date.now,sleep=ms=>new Promise(r=>setTimeout(r,ms)),checkpoint=()=>{}}={}){Object.assign(this,{client,now,sleep,checkpoint});this.active=null;this.generation=0;}
 async set(power,endAtMs,{valid=()=>true}={}){
  if(!Number.isInteger(power)||Math.abs(power)>2500||!Number.isFinite(endAtMs)||endAtMs<=this.now()||endAtMs-this.now()>300000)throw Error('Invalid timed action');
  const generation=++this.generation,allowed=()=>generation===this.generation&&valid()&&this.now()<endAtMs;
  this.checkpoint({transport:'local-api',active:true,requestedW:power,endAtMs});
  for(let attempt=0;attempt<3&&allowed();attempt++){
   const remaining=Math.floor((endAtMs-this.now())/1000);if(remaining<1)break;
   try{const r=await this.client.setTimedPower(power,{endAtMs,valid:allowed});if(r.result.set_result!==true)throw Error('Setpoint rejected');}catch(error){if(!allowed())throw error;}
   if(!allowed())break;
   try{const r=await this.client.getMode({valid:allowed,expiresAtMs:endAtMs,timeoutMs:15000,priority:power===0?100:10});const w=r.result.ongrid_power;
    if(r.result.mode==='Passive'&&Number.isFinite(w)&&(power===0?Math.abs(w)<=30:Math.sign(w)===Math.sign(power)&&Math.abs(w)>=30)){
     this.active={power,endAtMs};return {status:'effect-confirmed',observedW:w,attempts:attempt+1,endAtMs};
    }
   }catch(error){if(!allowed())throw error;}
   await this.sleep(Math.min(1500*2**attempt,Math.max(0,endAtMs-this.now())));
  }
  throw Error('Timed action effect unconfirmed');
 }
 async stop(){this.generation++;const result=await this.set(0,this.now()+65000);this.active=null;this.checkpoint(null);return result;}
}
module.exports={TimedAction};
