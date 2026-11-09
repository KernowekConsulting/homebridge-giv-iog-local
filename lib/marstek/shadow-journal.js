'use strict';
const fs = require('node:fs'); const { randomUUID } = require('node:crypto');
class ShadowJournal {
  constructor(file, identity) {
    this.file = file; this.identity = identity; this.sequence = 0;
    try {
      if (fs.statSync(file).size > 65536) throw new Error('Oversized shadow journal');
      const saved = JSON.parse(fs.readFileSync(file,'utf8'));
      if (saved.schema !== 1 || saved.identity !== identity || saved.shadowOnly !== true || !Number.isSafeInteger(saved.sequence) || saved.sequence < 0) throw new Error('Invalid shadow journal identity/schema');
      this.sequence = saved.sequence;
    } catch (error) { if(error.code !== 'ENOENT')throw error; }
  }
  record(request, observedAtMs) {
    const record = { schema:1, shadowOnly:true, identity:this.identity, sequence:this.sequence+1, recordedAtMs:observedAtMs, request };
    const text=JSON.stringify(record,null,2)+'\n'; if(Buffer.byteLength(text)>65536)throw new Error('Shadow journal capacity exceeded');
    const temporary=this.file+'.'+randomUUID()+'.tmp';
    try { fs.writeFileSync(temporary,text,{mode:0o600,flag:'wx'}); fs.renameSync(temporary,this.file); }
    finally { try { fs.unlinkSync(temporary); } catch(e) { if(e.code!=='ENOENT')throw e; } }
    this.sequence=record.sequence; return record;
  }
}
// Verification contract for a future actuator. An acknowledgement is never physical proof.
function verifyObservation(intent, observation, nowMs) {
  if (!observation || observation.identity !== intent.identity) return { verified:false, reason:'identity' };
  if (nowMs >= intent.request.leaseUntilMs || observation.observedAtMs > nowMs || observation.observedAtMs < intent.recordedAtMs || nowMs-observation.observedAtMs>3000) return { verified:false, reason:'expired-or-stale' };
  if (!Number.isFinite(observation.acDischargeW) || Math.abs(observation.acDischargeW-intent.request.powerW)>100) return { verified:false, reason:'power-not-observed' };
  return { verified:true, reason:'observed-within-tolerance' };
}
module.exports={ShadowJournal,verifyObservation};
