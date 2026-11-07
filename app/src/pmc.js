import {addDays,validDate,physiologyAt} from './performance.js';
import {activityCalendarDate} from './garmin-fit-analysis.js';

// We require six months of observed history before displaying model estimates.
// This is a quality gate, not a claim that the imported Garmin catalogue is complete.
export const PMC_AUDIT_DAYS=180;
export const validLoad=value=>value!==null&&value!==undefined&&String(value).trim()!==''&&Number.isFinite(Number(value))&&Number(value)>=0&&Number(value)<=5000;

// Deliberately do not interpret free text such as Z2 or convert pulse/RPE to TSS.
export function plannedLoad(workout,physiology=[]){
 if(validLoad(workout.estimated_tss))return {load:Number(workout.estimated_tss),source:'Carga indicada por el entrenador'};
 if(workout.sport!=='cycling'||!Array.isArray(workout.steps)||!workout.steps.length)return {load:null,source:'Falta carga prevista'};
 const ftp=validDate(workout.scheduled_date)?physiologyAt(physiology,'cycling',workout.scheduled_date)?.ftp:null;
 let total=0;
 for(const step of workout.steps){
  const seconds=Number(step.duration_seconds),low=Number(step.low),high=Number(step.high);
  if(!Number.isFinite(seconds)||seconds<=0||step.low==null||step.high==null||!Number.isFinite(low)||!Number.isFinite(high)||low<=0||high<low)return {load:null,source:'Hay bloques sin objetivo de potencia'};
  let intensity;
  if(step.target_type==='ftp_pct')intensity=(low+high)/200;
  else if(step.target_type==='watts'&&Number(ftp)>0)intensity=(low+high)/2/Number(ftp);
  else return {load:null,source:'Falta potencia o FTP vigente para estimar'};
  total+=seconds/3600*intensity**2*100;
 }
 return validLoad(total)?{load:total,source:'Estimación por bloques a potencia media objetivo'}:{load:null,source:'Carga fuera de rango'};
}

export function buildPMC({activities=[],metrics=[],physiology=[],workouts=[],today,historyDays=90,futureDays=21,mode='calendar'}){
 if(!validDate(today)||!Number.isInteger(historyDays)||historyDays<7||historyDays>365||!Number.isInteger(futureDays)||futureDays<1||futureDays>90||!['calendar','rest'].includes(mode))throw new Error('Revisa el período de la gráfica.');
 const end=addDays(today,futureDays),visibleStart=addDays(today,1-historyDays),auditStart=addDays(today,1-PMC_AUDIT_DAYS);
 const daily=new Map(),byId=new Map(metrics.map(m=>[m.activity_id,m]));
 const get=date=>{if(!daily.has(date))daily.set(date,{date,load:0,missing:0,items:[]});return daily.get(date);};
 let first=null,recentActivities=0,recentWithTss=0;
 const recentMissing=[];
 for(const a of activities){
  const date=activityCalendarDate(a.started_at);
  if(!validDate(date)||date>today)continue;
  if(!first||date<first)first=date;
  const metric=byId.get(a.id),load=validLoad(metric?.tss)?Number(metric.tss):null,day=get(date);
  if(load===null)day.missing++;else day.load+=load;
  if(date>=auditStart){
   recentActivities++;
   if(load===null)recentMissing.push({id:a.id,date,title:a.title||'Actividad sin título',sport:a.sport||'other'});
   else recentWithTss++;
  }
  day.items.push({id:a.id,title:a.title,load,source:metric?.tss_source||'Sin TSS disponible',planned:false});
 }
 for(const w of workouts){
  if(mode==='rest'||w.status!=='planned'||!validDate(w.scheduled_date)||w.scheduled_date<=today||w.scheduled_date>end)continue;
  const estimate=plannedLoad(w,physiology),day=get(w.scheduled_date);
  if(estimate.load===null)day.missing++;else day.load+=estimate.load;
  day.items.push({id:w.id,title:w.title,...estimate,planned:true});
 }
 // Warm up from the earliest received activity, never restart at the chart's left edge.
 const start=first&&first<visibleStart?first:visibleStart;
 let ctl=0,atl=0,missing=0,hasKnown=false;const series=[];
 for(let date=start;date<=end;date=addDays(date,1)){
  const day=get(date),tsb=ctl-atl;
  missing+=day.missing;
  if(day.items.some(x=>x.load!==null))hasKnown=true;
  ctl+=(day.load-ctl)/42;atl+=(day.load-atl)/7;
  if(date>=visibleStart)series.push({...day,ctl,atl,tsb,partial:missing>0,missingToDate:missing,projected:date>today,hasKnown});
 }
 const historyBeforeWindow=first!==null&&first<=auditStart;
 return {series,today:series.find(r=>r.date===today),target:series.at(-1),firstDate:first,
  missingHistory:series.find(r=>r.date===today).missingToDate,
  missingFuture:series.filter(r=>r.projected).reduce((n,r)=>n+r.missing,0),
  plannedCount:series.filter(r=>r.projected).reduce((n,r)=>n+r.items.length,0),
  audit:{from:auditStart,through:today,activityCount:recentActivities,withTss:recentWithTss,
   withoutTss:recentMissing.length,historyBeforeWindow,
   canDisplayModel:historyBeforeWindow&&recentMissing.length===0,
   // No exact CTL/ATL/TSB claim: source completeness and older stress remain unverified.
   unresolvedActivities:recentMissing.sort((a,b)=>b.date.localeCompare(a.date)).slice(0,50)}};

}
