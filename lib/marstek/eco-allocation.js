'use strict';
// The AIO retains its native fast Eco loop. Venus carries a steady capacity
// share near parity and prioritises steady load while Venus is fuller.
const CATCH_UP_CEILING_W=1980;
const PARITY_BAND_PERCENT=2;
function ecoAllocation({gateway:g,venus:v,aioCapacityKwh,venusCapacityKwh,aioReserve,venusReserve,maxDischargeW}){
 const aCap=aioCapacityKwh*g.units.length,vCap=venusCapacityKwh;
 const aSoc=g.units.reduce((s,u)=>s+u.socPercent,0)/g.units.length;
 const demandW=Math.max(0,g.aioDischargeW+v.acDischargeW-g.gridExportW);
 const share=vCap/(aCap+vCap),gap=v.socPercent-aSoc;
 const correctionW=Math.min(0,gap+PARITY_BAND_PERCENT)/100*(aCap*vCap/(aCap+vCap))*1000/2;
 const catchingUp=gap>PARITY_BAND_PERCENT;
 // Leave a small AIO contribution to absorb variation; don't feed its charging.
 const aioAtReserve=g.units.every(u=>u.socPercent<=aioReserve);
 const importMarginW=aioAtReserve?0:50;
 const headroomW=Math.max(0,demandW-importMarginW);
 const reservePowerW=Math.max(0,v.socPercent-venusReserve)/100*vCap*3600000*.94/120;
 let targetW=Math.max(0,share*demandW+correctionW);
 if(aioAtReserve||catchingUp)targetW=headroomW;
 if(catchingUp)targetW=g.gridExportW-v.acDischargeW>importMarginW?0:Math.min(targetW,CATCH_UP_CEILING_W);
 if(v.socPercent<=venusReserve||g.aioDischargeW< -50)targetW=0;
 return {targetW:Math.min(targetW,headroomW,maxDischargeW,reservePowerW),demandW,importMarginW,capacityShare:share,socGap:gap,correctionW,catchingUp};
}
module.exports={ecoAllocation};
