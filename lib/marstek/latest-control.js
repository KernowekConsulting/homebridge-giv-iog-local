'use strict';
// Keep observing while delivery/verification is pending. Only the newest
// unstarted proposal is retained; the session still checks live authority.
class LatestControl {
 constructor(session,{onResult=async()=>{},onError=async()=>{}}={}){Object.assign(this,{session,onResult,onError});this.pending=null;this.inFlight=null;this.closed=false;}
 submit(plan,sample){if(this.closed)return Promise.resolve();this.pending={plan,sample,generation:this.session.generation};if(!this.inFlight)this.inFlight=Promise.resolve().then(()=>this.drain()).finally(()=>{this.inFlight=null;});return this.inFlight;}
 async drain(){while(this.pending&&!this.closed){const item=this.pending;this.pending=null;if(item.generation!==this.session.generation)continue;try{await this.onResult(await this.session.apply(item.plan,item.sample));}catch(error){try{await this.onError(error);}catch(fault){this.lastError=fault;this.stop();}}}}
 clear(){this.pending=null;}
 stop(){this.closed=true;this.clear();}
}
module.exports={LatestControl};
