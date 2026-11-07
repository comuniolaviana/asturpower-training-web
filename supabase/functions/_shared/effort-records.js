// Maximum arithmetic means over complete consecutive one-second recordings.
// No FTP conversion, resampling, interpolation, gap stitching or zero suppression.
export const RECORD_DURATIONS=Object.freeze([60,300,600,1200,1800,3600]);
export const RECORD_ALGORITHM=1;
const millis=v=>typeof v==='number'?v:Date.parse(v);
const normalize=v=>String(v??'').replace(/[_\s-]/g,'').toLowerCase();
export function calculateEffortBests(data){
 if(data?.version!==1||!Array.isArray(data.fields)||!Array.isArray(data.rows)||data.rows.length>250000||data.fields.length>1000)throw Error('invalid_series');
 const ti=data.fields.indexOf('timestamp'),pi=data.fields.indexOf('power'),hi=data.fields.indexOf('heartRate');
 const times=data.rows.map(row=>millis(row?.[ti]));
 const events=(data.events||[]).filter(e=>normalize(e.event)==='timer'&&Number.isFinite(millis(e.timestamp))).map(e=>({at:millis(e.timestamp),type:normalize(e.eventType)})).sort((a,b)=>a.at-b.at);
 const origin=millis(data.sessions?.[0]?.startTime),states=[{metric:'power',index:pi,valid:v=>typeof v==='number'&&Number.isFinite(v)&&v>=0&&v<65535},{metric:'heartRate',index:hi,valid:v=>typeof v==='number'&&Number.isFinite(v)&&v>0&&v<255}];
 for(const s of states){s.ring=new Float64Array(3600);s.sums=new Float64Array(RECORD_DURATIONS.length);s.best=Array(RECORD_DURATIONS.length).fill(null);s.count=0;s.seconds=0;}
 const reset=()=>{for(const s of states){s.count=0;s.sums.fill(0);}};
 let previous=null,active=true,eventIndex=0;
 for(let rowIndex=0;rowIndex<data.rows.length;rowIndex++){
  const row=data.rows[rowIndex],at=times[rowIndex];
  if(!Array.isArray(row)||row.length!==data.fields.length)throw Error('invalid_series');
  if(!Number.isFinite(at)||ti<0||at===times[rowIndex-1]||at===times[rowIndex+1]){reset();previous=null;continue;}
  if(previous===null||at-previous!==1000)reset();
  previous=at;
  while(eventIndex<events.length&&events[eventIndex].at<=at){const type=events[eventIndex++].type;if(type==='start'){active=true;reset();}else if(['stop','stopall','stopdisable','stopdisableall'].includes(type)){active=false;reset();}}
  if(!active){reset();continue;}
  for(const s of states){
   const value=row[s.index];
   if(s.index<0||!s.valid(value)){s.count=0;s.sums.fill(0);continue;}
   const index=s.count%3600;
   for(let i=0;i<RECORD_DURATIONS.length;i++){
    const duration=RECORD_DURATIONS[i];
    s.sums[i]+=value-(s.count>=duration?s.ring[(s.count-duration)%3600]:0);
    if(s.count+1>=duration){
     const mean=s.sums[i]/duration,prior=s.best[i],start=at-(duration-1)*1000;
     if(!prior||mean>prior.mean+1e-9||(Math.abs(mean-prior.mean)<=1e-9&&start<Date.parse(prior.start_at))){
      s.best[i]={metric:s.metric,seconds:duration,mean,start_at:new Date(start).toISOString(),end_at:new Date(at).toISOString(),offset_seconds:Number.isFinite(origin)?(start-origin)/1000:null};
     }
    }
   }
   s.ring[index]=value;s.count++;s.seconds++;
  }
 }
 return {algorithm_version:RECORD_ALGORITHM,record_count:data.rows.length,power_seconds:states[0].seconds,heart_rate_seconds:states[1].seconds,bests:states.flatMap(s=>s.best.filter(Boolean))};
}
