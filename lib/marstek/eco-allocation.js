'use strict';
// The AIO retains its native fast Eco loop. Venus carries a steady capacity
// share, with a two-hour correction of the SOC gap, bounded by measured demand.
function ecoAllocation({gateway:g,venus:v,aioCapacityKwh,venusCapacityKwh,aioReserve,venusReserve,maxDischargeW}){
 const aCap=aioCapacityKwh*g.units.length,vCap=venusCapacityKwh;
 const aSoc=g.units.reduce((s,u)=>s+u.socPercent,0)/g.units.length;
 const demandW=Math.max(0,g.aioDischargeW+v.acDischargeW-g.gridExportW);
 const share=vCap/(aCap+vCap),gap=v.socPercent-aSoc;
 const correctionW=gap/100*(aCap*vCap/(aCap+vCap))*1000/2;
 // Leave a small AIO contribution to absorb variation; don't feed its charging.
 const headroomW=Math.max(0,demandW-50);
 const reservePowerW=Math.max(0,v.socPercent-venusReserve)/100*vCap*3600000*.94/120;
 let targetW=Math.max(0,share*demandW+correctionW);
 if(g.units.every(u=>u.socPercent<=aioReserve))targetW=headroomW;
 if(v.socPercent<=venusReserve||g.aioDischargeW< -50)targetW=0;
 return {targetW:Math.min(targetW,headroomW,maxDischargeW,reservePowerW),demandW,capacityShare:share,socGap:gap,correctionW};
}
module.exports={ecoAllocation};
