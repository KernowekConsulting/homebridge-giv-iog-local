'use strict';
function combinedSocLevel(latest,now=Date.now()){
 const age=now-latest?.at,value=latest?.result?.combinedSoc;
 if(!latest||!Number.isFinite(age)||age<0||age>6000||!Number.isFinite(value)||value<0||value>100)return null;
 return Math.round(value);
}
// Display-only SOC does not need grid watts. Keep the original component ages;
// this result must never be used as a control observation or activation guard.
function independentSocLevel({gateway,aio,venus,serial,aioCapacityKwh,venusCapacityKwh},now=Date.now()){
 const fresh=x=>Number.isFinite(x)&&x<=now&&now-x<=90000;
 const soc=x=>Number.isFinite(x)&&x>=0&&x<=100;
 const m=venus?.sample?.model;
 if(!Number.isFinite(now)||gateway?.identityFault||gateway?.knownCount!==1||!fresh(gateway.topologySample?.observedAtMs)||aio?.identityVerified!==true||!serial||aio.serial!==serial||!fresh(aio.observedAtMs)||!soc(aio.socPercent)||!m?.binding||/identity|Unqualified Venus/i.test(venus.lastError||'')||!fresh(m.observedAtMs)||!fresh(m.identityAtMs)||!soc(m.socPercent)||![aioCapacityKwh,venusCapacityKwh].every(c=>Number.isFinite(c)&&c>0))return null;
 return Math.round((aio.socPercent*aioCapacityKwh+m.socPercent*venusCapacityKwh)/(aioCapacityKwh+venusCapacityKwh));
}
module.exports={combinedSocLevel,independentSocLevel};
