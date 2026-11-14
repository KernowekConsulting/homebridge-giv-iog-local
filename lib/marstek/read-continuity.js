'use strict';
const {performance}=require('node:perf_hooks');
const {FRESH_ATTEMPT_GAP_MS}=require('../evidence-led-constants');
function retryable(error){
 if(['ECONNREFUSED','ECONNRESET','EHOSTUNREACH','ENETUNREACH','ETIMEDOUT','EPIPE'].includes(error?.code))return true;
 return /^(connect timed out|receive timed out|read timed out|Gateway snapshot span too long|Venus request timed out|Venus connection closed|Venus response incomplete)$/.test(error?.message||'');
}
// Whole endpoint observations are retried, never partial banks or command writes.
async function recoverRead(read,{source,deadline,enabled=false,monotonic=()=>performance.now(),valid=()=>true,sleep=ms=>new Promise(r=>setTimeout(r,ms)),onEvent=()=>{},gapMs=FRESH_ATTEMPT_GAP_MS,minRemainingMs=750}={}){
 for(let attempt=1;attempt<=2;attempt++){
  const started=monotonic();
  try{
   if(!valid())throw Error('Read recovery revoked');
   const value=await read({attempt,remainingMs:Math.max(0,deadline-monotonic()),hybrid:enabled});
   if(!valid()||Number.isFinite(deadline)&&monotonic()>=deadline){const error=Error('Read recovery expired');error.continuityExpired=true;throw error;}
   onEvent({source,phase:attempt===1?'read-ok':'read-recovered',attempt,elapsedMs:Math.round(monotonic()-started)});
   return value;
  }catch(error){
   const canRetry=enabled&&attempt===1&&retryable(error)&&valid()&&deadline-monotonic()>=gapMs+minRemainingMs;
   onEvent({source,phase:error.continuityExpired?'read-expired':'read-failed',attempt,elapsedMs:Math.round(monotonic()-started),error:error.message,retryable:retryable(error),retryScheduled:canRetry});
   if(!canRetry){error.readSource=source;throw error;}
   await sleep(gapMs);
   if(!valid()||deadline-monotonic()<minRemainingMs){error.readSource=source;throw error;}
  }
 }
}
module.exports={recoverRead,retryable};
