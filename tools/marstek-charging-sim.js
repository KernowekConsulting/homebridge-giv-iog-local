'use strict';
const fs=require('node:fs');
const {ChargingPolicy}=require('../lib/marstek/charging-policy');
// Synthetic plant. Device lease behaviour here is an assumption to qualify later.
function simulateCharging({seconds=21600,initialSoc=20,targetSoc=100,iog=false,windowSeconds=iog?1800:21600,lagSeconds=1,responseSeconds=3,commandDelaySeconds=1,dropFrom=Infinity,dropUntil=Infinity,repeated=false}={}){
 const policy=new ChargingPolicy();let soc=initialSoc,power=0,aio=0,deviceTarget=0,expires=0,sequence=0,accepted=0;
 const queue=[],history=[],series=[];let acChargeWh=0,firstTargetSecond=null,latestG=null,latestV=null,maxRequestedChargeW=0;
 for(let second=0;second<seconds;second++){
  const nowMs=100000+second*1000;
  for(let i=queue.length-1;i>=0;i--)if(queue[i].due<=second){const q=queue.splice(i,1)[0];if(q.sequence>accepted){accepted=q.sequence;deviceTarget=q.request.powerW;expires=q.request.leaseUntilMs;}}
  if(nowMs>=expires)deviceTarget=0;
  let effective=deviceTarget;
  if(effective<0&&soc>95)effective=Math.max(effective,-Math.max(250,2500*(100-soc)/5));
  if(soc>=100&&effective<0)effective=0;
  power+=(effective-power)/responseSeconds;
  if(Math.abs(power)<.1)power=0;
  const acWh=power/3600;
  soc=Math.max(0,Math.min(100,soc+(power<0 ? -acWh*.92 : -acWh/.94)/5120*100));
  if(power<0)acChargeWh-=acWh;
  // AIO deliberately charges in the cheap window; later reverts to a lagged Eco response.
  const aioTarget=second<windowSeconds?-2000:Math.max(-2500,Math.min(6000,700-power));aio+=(aioTarget-aio)/2;
  const grid=aio+power-700;
  history.push({gateway:{observedAtMs:nowMs,gridExportW:grid,aioDischargeW:aio},venus:{observedAtMs:nowMs,socPercent:soc,acDischargeW:power,acDirectionQualified:true}});
  if(second%2===0){
   const observed=history[Math.max(0,second-lagSeconds)];
   if(!(second>=dropFrom&&second<dropUntil)&&(!repeated||second<20)){latestG=observed.gateway;latestV=observed.venus;}
   const context={overnightEnabled:!iog,nightActive:!iog&&second<windowSeconds,nightTargetSoc:targetSoc,nightEndAtMs:100000+windowSeconds*1000,
    iogEnabled:iog,iogActive:iog&&second<windowSeconds,iogFresh:true,iogFetchedAtMs:nowMs,iogMode:'charge',iogTargetSoc:targetSoc,iogEndAtMs:100000+windowSeconds*1000};
   const request=policy.step({gateway:latestG,venus:latestV,nowMs,context});
   if(request.kind!=='wait')queue.push({due:second+commandDelaySeconds,sequence:++sequence,request});
   maxRequestedChargeW=Math.max(maxRequestedChargeW,-request.powerW);
   if(request.reason==='target-reached-protected'&&firstTargetSecond===null)firstTargetSecond=second;
   if(second%10===0)series.push({second,socPercent:soc,venusACW:power,gridExportW:grid,requestW:request.powerW,reason:request.reason});
  }
 }
 return {assumptions:{capacityWh:5120,chargeEfficiency:.92,dischargeEfficiency:.94,lagSeconds,responseSeconds,commandDelaySeconds,leaseIsSimulated:true},metrics:{initialSoc,finalSoc:soc,acChargeKWh:acChargeWh/1000,firstTargetSecond,maxRequestedChargeW,finalACW:power},series};
}
if(require.main===module){const scenarios={overnight100:simulateCharging(),nightTarget70:simulateCharging({targetSoc:70}),iog30Minutes:simulateCharging({iog:true,seconds:2400,windowSeconds:1800}),outageAndRecovery:simulateCharging({seconds:900,dropFrom:60,dropUntil:120}),repeatedTelemetry:simulateCharging({seconds:120,repeated:true}),slowTelemetry:simulateCharging({seconds:120,lagSeconds:8})};const report={syntheticOnly:true,scenarios};if(process.argv[2])fs.writeFileSync(process.argv[2],JSON.stringify(report,null,2));else console.log(JSON.stringify(report,null,2));}
module.exports={simulateCharging};
