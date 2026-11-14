'use strict';
const dgram=require('node:dgram');
class ApiSimulator{
 constructor({actuationDelayMs=0,expiryMode='Passive',dropSetReply=false,src='VenusE-ccc837a1b440',device='VenusE 3.0'}={}){Object.assign(this,{actuationDelayMs,expiryMode,dropSetReply,src,device});this.mode='Passive';this.soc=60;this.power=0;this.expires=0;this.requests=[];this.fault=null;this.version=144;this.mac='ccc837a1b440';this.socket=dgram.createSocket('udp4');this.socket.on('message',(data,peer)=>this.receive(data,peer));}
 async start(){await new Promise(r=>this.socket.bind(0,'127.0.0.1',r));this.port=this.socket.address().port;return this;}
 output(){if(this.expires&&Date.now()>=this.expires){this.power=0;this.mode=this.expiryMode;this.expires=0;}return Date.now()<(this.settleAt??0)?0:this.power;}
 receive(data,peer){const q=JSON.parse(data);this.requests.push({...q,at:Date.now(),length:data.length});if(this.fault==='drop')return;const power=this.output();let result;if(q.method==='Marstek.GetDevice')result={device:this.device,ver:this.version,ble_mac:this.mac,ip:'127.0.0.1'};else if(q.method==='ES.GetMode')result={id:0,mode:this.mode,bat_soc:this.soc,ongrid_power:power,offgrid_power:0,ct_state:0};else if(q.method==='ES.GetStatus')result={id:0,bat_soc:this.soc,bat_cap:5120,ongrid_power:power,bat_power:power};else if(q.method==='ES.SetMode'){this.mode=q.params.config.mode;if(this.power!==q.params.config.passive_cfg.power)this.settleAt=Date.now()+this.actuationDelayMs;this.power=q.params.config.passive_cfg.power;this.expires=Date.now()+q.params.config.passive_cfg.cd_time*1000;result={id:0,set_result:true};if(this.dropSetReply&&this.power!==0)return;}else result={};
  const reply={id:q.id,src:this.fault==='src'?'wrong-device':this.src,result};if(this.fault==='wrong-id')reply.id=q.id+1;if(this.fault==='invalid-soc')reply.result.bat_soc=65535;if(this.fault==='method-error'){delete reply.result;reply.error={code:-32601,message:'Method unavailable'};}this.socket.send(Buffer.from(JSON.stringify(reply)),peer.port,peer.address);
 }
 async close(){await new Promise(r=>this.socket.close(r));}
}
module.exports={ApiSimulator};
