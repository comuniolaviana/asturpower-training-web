// Conservative analysis of real FIT activity files. Never estimate missing samples.
import {decodeCompleteFit} from './garmin-full-fit.js';
export const FIT_ANALYSIS_VERSION=1;
function timeMs(value){
 if(value instanceof Date)return value.getTime();
 if(typeof value==='string')return Date.parse(value);
 return NaN;
}
function sportOf(value){
 const str=String(value??'').toLowerCase().replace(/[_\s-]/g,'');
 if(str.includes('cycling')||str.includes('biking'))return 'cycling';
 if(str.includes('running'))return 'running';
 if(str.includes('swimming'))return 'swimming';
 if(str.includes('walking'))return 'walking';
 if(str.includes('strength'))return 'strength';
 return 'other';
}
export function normalizedPower(records,timerSeconds){
 if(!Array.isArray(records)||!Number.isFinite(timerSeconds)||timerSeconds<30||timerSeconds>172800)return {np:null,powerSeconds:0,coverage:0};
 const bySecond=new Map();
 for(const record of records){
  const ms=timeMs(record?.timestamp),p=record?.power;
  if(!Number.isFinite(ms)||typeof p!=='number'||!Number.isFinite(p)||p<0||p>3500)continue;
  const second=Math.round(ms/1000);
  if(!bySecond.has(second))bySecond.set(second,p);
 }
 const seq=[...bySecond.entries()].sort((a,b)=>a[0]-b[0]);
 const powerSeconds=seq.length,coverage=Math.min(1,powerSeconds/timerSeconds);
 if(powerSeconds<60||coverage<0.9)return {np:null,powerSeconds,coverage};
 const queue=[];let sum=0,fourth=0,windows=0,previous=null;
 for(const [sec,power] of seq){
  if(previous!==null&&sec!==previous+1){queue.length=0;sum=0;}
  previous=sec;queue.push(power);sum+=power;
  if(queue.length>30)sum-=queue.shift();
  if(queue.length===30){fourth+=Math.pow(sum/30,4);windows++;}
 }
 if(windows<30)return {np:null,powerSeconds,coverage};
 const np=Math.pow(fourth/windows,0.25);
 return {np:Number(np.toFixed(2)),powerSeconds,coverage};
}
export function analyzeFitBytes(bytes){
 const decoded=decodeCompleteFit(bytes),sessions=decoded.messages.sessionMesgs||[],records=decoded.messages.recordMesgs||[];
 // One session is required. Multisport files and wellness FIT files cannot
 // be safely attached to an individual calendar activity at this stage.
 if(sessions.length!==1||records.length<20)return null;
 const session=sessions[0],started=timeMs(session.startTime),timer=Number(session.totalTimerTime);
 if(!Number.isFinite(started)||started<Date.UTC(1990,0,1)||!Number.isFinite(timer)||timer<20||timer>172800)return null;
 const sport=sportOf(session.sport),start=new Date(started).toISOString();
 const distance=typeof session.totalDistance==='number'&&Number.isFinite(session.totalDistance)?session.totalDistance:null;
 const power=sport==='cycling'?normalizedPower(records,timer):{np:null,powerSeconds:0,coverage:0};
 return {started_at:start,sport,timer_seconds:timer,distance_meters:distance,
  sample_count:records.length,power_seconds:power.powerSeconds,power_coverage:power.coverage,
  normalized_power_watts:power.np};
}
export function matchFitActivity(fit,activities){
 if(!fit||!Array.isArray(activities)||fit.sport==='other')return null;
 const fitMs=Date.parse(fit.started_at);if(!Number.isFinite(fitMs))return null;
 const candidates=activities.filter(a=>{
  if(a.sport!==fit.sport)return false;
  const ms=Date.parse(a.started_at),diff=Math.abs(ms-fitMs);
  if(!Number.isFinite(ms)||diff>180000)return false;
  const timer=Number(a.duration_seconds);
  if(!Number.isFinite(timer)||Math.abs(timer-fit.timer_seconds)>Math.max(120,0.25*timer))return false;
  if(fit.distance_meters!==null&&a.distance_meters!==null){
   const meters=Number(a.distance_meters);
   if(!Number.isFinite(meters)||Math.abs(meters-fit.distance_meters)>Math.max(500,0.15*Math.max(meters,fit.distance_meters)))return false;
  }
  return true;
 });
 if(candidates.length!==1)return null;
 return {activity:candidates[0],offset_seconds:Math.round(Math.abs(Date.parse(candidates[0].started_at)-fitMs)/1000)};
}
export function ftpForDate(versions,date){
 return [...versions].filter(r=>r.sport==='cycling'&&r.effective_date<=date&&
  Number.isFinite(Number(r.ftp))&&Number(r.ftp)>=1&&Number(r.ftp)<=2500)
  .sort((a,b)=>b.effective_date.localeCompare(a.effective_date)||
   String(b.created_at||'').localeCompare(String(a.created_at||'')))[0]||null;
}
export function derivedFitRow(fit,matched,ftpVersions,{athleteId,archiveId,packName,fileName}){
 if(!fit||!matched||!athleteId)return null;
 const ftp=fit.sport==='cycling'&&fit.normalized_power_watts!==null?
  ftpForDate(ftpVersions,fit.started_at.slice(0,10)):null;
 const ftpWatts=ftp?Number(ftp.ftp):null,normalized=fit.normalized_power_watts;
 const intensity=ftpWatts?normalized/ftpWatts:null;
 const tss=intensity===null?null:fit.timer_seconds/3600*intensity*intensity*100;
 if(tss!==null&&(!Number.isFinite(tss)||tss>5000))return null;
 return {athlete_id:athleteId,activity_id:matched.activity.id,archive_id:archiveId,
  pack_name:packName,file_name:fileName,fit_started_at:fit.started_at,sport:fit.sport,
  match_offset_seconds:matched.offset_seconds,duration_seconds:Math.round(fit.timer_seconds),
  sample_count:fit.sample_count,power_seconds:fit.power_seconds,
  power_coverage:Number(fit.power_coverage.toFixed(4)),
  normalized_power_watts:normalized,
  ftp_watts:ftpWatts,ftp_effective_date:ftp?.effective_date||null,
  intensity_factor:intensity===null?null:Number(intensity.toFixed(4)),
  tss:tss===null?null:Number(tss.toFixed(3)),
  measurement_source:'unverified',calculation_version:FIT_ANALYSIS_VERSION};
}
// Partial load model. No zero-TSS inference for days with unprocessed rides.
export function partialLoadCurve(rows,{from,to}={}){
 if(!Array.isArray(rows)||!from||!to||from>to)return [];
 const daily=new Map();for(const r of rows){
  if(r.sport!=='cycling'||r.tss===null||!Number.isFinite(Number(r.tss)))continue;
  const date=String(r.fit_started_at).slice(0,10);
  daily.set(date,(daily.get(date)||0)+Number(r.tss));
 }
 let ctl=0,atl=0;const output=[];
 for(let current=from;current<=to;){
  const load=daily.get(current)||0,tsb=ctl-atl;
  ctl+=(load-ctl)/42;atl+=(load-atl)/7;
  output.push({date:current,known_cycling_tss:load,partial_ctl:ctl,partial_atl:atl,partial_tsb:tsb});
  const day=new Date(current+'T12:00:00Z');day.setUTCDate(day.getUTCDate()+1);
  const next=day.toISOString().slice(0,10);if(next===current||output.length>366)break;current=next;
 }
 return output;
}

export function resolveHistoricalTss(row,versions){
 if(!row||row.sport!=='cycling'||row.normalized_power_watts===null||row.normalized_power_watts===undefined)
  return {...row,tss:null,intensity_factor:null,ftp_watts:null,ftp_effective_date:null};
 const np=Number(row.normalized_power_watts),ftp=ftpForDate(versions,String(row.fit_started_at).slice(0,10));
 if(!ftp||!Number.isFinite(np)||np<0)
  return {...row,tss:null,intensity_factor:null,ftp_watts:null,ftp_effective_date:null};
 const watts=Number(ftp.ftp),duration=Number(row.duration_seconds);
 if(!Number.isFinite(duration)||duration<1||duration>172800)
  return {...row,tss:null,intensity_factor:null,ftp_watts:null,ftp_effective_date:null};
 const intensity=np/watts,tss=duration/3600*intensity*intensity*100;
 if(!Number.isFinite(tss)||tss>5000)
  return {...row,tss:null,intensity_factor:null,ftp_watts:null,ftp_effective_date:null};
 return {...row,ftp_watts:watts,ftp_effective_date:ftp.effective_date,
  intensity_factor:Number(intensity.toFixed(4)),tss:Number(tss.toFixed(3))};
}
