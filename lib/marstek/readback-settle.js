'use strict';
// Delivery remains one-shot. A device may expose its new state after the first
// read; only the readback is repeated, while the original authority remains valid.
async function settleReadback(read,{expected,enabled=false,valid=()=>true,sleep=ms=>new Promise(r=>setTimeout(r,ms))}={}){
 let value;
 for(let i=0;i<(enabled?3:1);i++){
  if(i){if(!valid())throw Error('Marstek activation revoked');await sleep(300*i);if(!valid())throw Error('Marstek activation revoked');}
  value=await read();if(value===expected)return value;
 }
 return value;
}
module.exports={settleReadback};
