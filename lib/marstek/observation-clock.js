'use strict';
// A joined SOC observation keeps its own age. Recovery progress follows the
// independently sampled site meter, not the slower SOC register refresh.
function meterProgressAt(g,context={},nowMs=Date.now()){
 const t=g?.meterObservedAtMs;
 return context.localApiTimed===true&&g?.batteryEvidenceSource==='aio'&&g?.siteMeterSource==='gateway'&&Number.isFinite(t)&&t>=g.observedAtMs&&t<=nowMs?t:g?.observedAtMs;
}
module.exports={meterProgressAt};
