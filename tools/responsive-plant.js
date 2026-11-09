'use strict';
const fs=require('node:fs');
const {fixture,createSimulator}=require('./marstek-simulator');const {createGatewaySimulator}=require('./gateway-simulator');
class ResponsivePlant {
 constructor({speed=1,initialSoc=60}={}){if(!Number.isFinite(speed)||speed<=0||speed>60||!Number.isFinite(initialSoc)||initialSoc<20||initialSoc>100)throw Error("Invalid simulator speed or initial SOC");this.speed=speed;this.aSoc=initialSoc;this.vSoc=initialSoc;this.aPower=0;this.vPower=0;this.gatewayWords=new Map();this.venusWords=fixture({soc:600,power:0});this.update();}
 step(plan,now,seconds=1){const valid=plan&&Number.isFinite(plan.at)&&now-plan.at<=5000&&plan.at<=now&&plan.result?.leaseUntilMs>now&&plan.result.shadowOnly===true;const p=valid?plan.result:{aioW:0,venusW:0};let a=p.aioW||0,v=p.venusW||0;
  if(this.aSoc<=20&&a>0||this.aSoc>=100&&a<0)a=0;if(this.vSoc<=20&&v>0||this.vSoc>=100&&v<0)v=0;
  this.aPower+=(a-this.aPower)*Math.min(1,seconds/3);this.vPower+=(v-this.vPower)*Math.min(1,seconds/3);
  const change=(power,capacity)=>-power*(power<0?.92:1/.94)*seconds*this.speed/(3600000*capacity)*100;
  this.aSoc=Math.max(20,Math.min(100,this.aSoc+change(this.aPower,13.5)));this.vSoc=Math.max(20,Math.min(100,this.vSoc+change(this.vPower,5.12)));this.update();
 }
 update(){const g=this.gatewayWords;for(const [k,v] of [[1608,2418],[1616,Math.round(this.aPower+this.vPower-700)&65535],[1617,0],[1618,700],[1700,0],[1701,1],[1702,Math.round(-this.aPower)&65535],[1801,Math.round(this.aSoc)],[1816,Math.round(-this.aPower)&65535]])g.set(k,v);
  this.venusWords.set(34002,Math.round(this.vSoc*10));this.venusWords.set(30001,Math.round(-this.vPower)&65535);this.venusWords.set(30006,Math.round(this.vPower)&65535);
 }
}
if(require.main===module){const file=process.argv[2];if(!file)throw Error('Supply the isolated test plan feed');const plant=new ResponsivePlant({speed:Number(process.argv[3]||1),initialSoc:Number(process.argv[4]||60)});const servers=[createGatewaySimulator({registers:plant.gatewayWords}),createSimulator({registers:plant.venusWords})];servers[0].listen(8899,'127.0.0.1');servers[1].listen(15020,'127.0.0.1');const timer=setInterval(()=>{let plan;try{plan=JSON.parse(fs.readFileSync(file));}catch{}const now=Date.now();plant.step(plan,now);fs.writeFileSync(file+'.plant.json',JSON.stringify({at:now,speed:plant.speed,aioSoc:plant.aSoc,venusSoc:plant.vSoc,aioW:plant.aPower,venusW:plant.vPower}));},1000);console.log('Responsive test batteries: loopback only; '+plant.speed+'x energy time, real-time command leases.');const stop=()=>{clearInterval(timer);for(const s of servers){s.closeClients();s.close();}};process.on('SIGTERM',stop);process.on('SIGINT',stop);}
module.exports={ResponsivePlant};
