import {decodeCompleteFit} from './garmin-full-fit.js';
let decoded=null;
self.onmessage=({data})=>{
 try{
  if(data?.type==='decode'){
   decoded=null;decoded=decodeCompleteFit(new Uint8Array(data.bytes));
   self.postMessage({type:'decoded',counts:decoded.counts,profileVersion:decoded.profileVersion});
  }else if(data?.type==='page'&&decoded){
   const rows=Object.hasOwn(decoded.messages,data.messageType)?decoded.messages[data.messageType]:[];
   const start=Math.max(0,Math.trunc(data.start)||0);
   self.postMessage({type:'page',messageType:data.messageType,start,total:rows.length,rows:rows.slice(start,start+25)});
  }
 }catch(error){decoded=null;self.postMessage({type:'error',message:error.message});}
};
