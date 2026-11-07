import {activityCalendarDate} from './garmin-fit-analysis.js';

// Read-only comparison. TrainingPeaks exports are private: do not upload, persist,
// log or automatically merge CSV rows into any Garmin activity.
const MAX_BYTES=4*1024*1024,MAX_ROWS=12000;
const KEY=s=>String(s??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]/g,'');
const strictNumber=s=>{
 const raw=String(s??'').trim().replace(',', '.');
 return /^(?:\d+(?:\.\d+)?|\.\d+)$/.test(raw)?Number(raw):null;
};
const validDate=s=>/^\d{4}-\d{2}-\d{2}$/.test(s)&&!Number.isNaN(Date.parse(s+'T12:00:00Z'))&&new Date(s+'T12:00:00Z').toISOString().slice(0,10)===s;
export function detectDelimiter(text){
 const counts={',':0,';':0,'\t':0};let quoted=false;
 for(let i=0;i<text.length;i++){
  const ch=text[i];
  if(ch==='"'){if(quoted&&text[i+1]==='"'){i++;continue;}quoted=!quoted;}
  else if(!quoted&&(ch==='\r'||ch==='\n'))break;
  else if(!quoted&&Object.hasOwn(counts,ch))counts[ch]++;
 }
 const result=Object.entries(counts).sort((a,b)=>b[1]-a[1])[0];
 if(!result||result[1]===0)throw new Error('El archivo no parece un CSV con columnas separadas.');
 return result[0];
}
export function splitCsv(text,delimiter=detectDelimiter(text)){
 if(typeof text!=='string'||text.length===0||new TextEncoder().encode(text).length>MAX_BYTES)throw new Error('El CSV debe contener texto y ocupar menos de 4 MB.');
 const rows=[];let row=[],field='',quoted=false,started=false;
 const finishField=()=>{row.push(field);field='';started=false;};
 const finishRow=()=>{
  finishField();
  if(row.some(s=>s.trim()!=='')){
   rows.push(row);
   if(rows.length>MAX_ROWS+1)throw new Error('El CSV supera el límite de 12.000 entrenamientos.');
  }
  row=[];
 };
 for(let i=0;i<text.length;i++){
  const ch=text[i];
  if(quoted){
   if(ch==='"'){if(text[i+1]==='"'){field+='"';i++;}else quoted=false;}
   else field+=ch;
  }else if(ch==='"'&&!started){quoted=true;started=true;}
  else if(ch===delimiter){finishField();}
  else if(ch==='\r'||ch==='\n'){finishRow();if(ch==='\r'&&text[i+1]==='\n')i++;}
  else if(ch==='"')throw new Error('Comillas incorrectas en el CSV.');
  else {field+=ch;started=true;}
 }
 if(quoted)throw new Error('El CSV termina con comillas sin cerrar.');
 if(row.length||field)finishRow();
 return rows;
}
const SPORT={
 bike:'cycling',biking:'cycling',cycling:'cycling',mtb:'cycling',mountainbike:'cycling',roadbike:'cycling',virtualride:'cycling',
 run:'running',running:'running',trailrun:'running',swim:'swimming',swimming:'swimming',
 strength:'strength',weighttraining:'strength',walking:'walking',walk:'walking',hike:'walking',hiking:'walking',
 other:'other',custom:'other',xtrain:'other',crosstraining:'other',brick:'other'
};
function sportOf(v){return SPORT[KEY(v)]||null;}
export function parseTrainingPeaksSummary(text){
 const rows=splitCsv(String(text??'').replace(/^\uFEFF/,''));
 if(rows.length<2)throw new Error('El CSV no contiene entrenamientos.');
 const normalized=rows[0].map(KEY);
 if(new Set(normalized).size!==normalized.length)throw new Error('El CSV tiene columnas duplicadas.');
 const column=names=>names.map(KEY).map(n=>normalized.indexOf(n)).find(n=>n>=0)??-1;
 const day=column(['WorkoutDay']),sport=column(['WorkoutType']),tss=column(['TssActual','ActualTss','CompletedTss']),duration=column(['TotalTime']);
 if([day,sport,tss,duration].some(i=>i<0))throw new Error('Faltan columnas del resumen real: WorkoutDay, WorkoutType, TssActual y TotalTime. No se utiliza TssPlanned.');
 const complete=column(['Completed']),method=column(['TssCalculationMethod']);
 const entries=rows.slice(1).map((r,i)=>{
  const rowNumber=i+2,rawDate=String(r[day]??'').trim(),date=rawDate.slice(0,10),kind=sportOf(r[sport]);
  const stress=strictNumber(r[tss]),hours=strictNumber(r[duration]);
  const completed=complete>=0?String(r[complete]??'').trim().toLowerCase():null;
  const info={rowNumber,date,sport:kind,sourceSport:String(r[sport]??''),tss:stress,
   method:method<0?'No indicado':String(r[method]??'').slice(0,45),seconds:hours===null?null:Math.round(hours*3600)};
  if(completed==='false'||completed==='no'||completed==='0')return {...info,status:'skipped',reason:'Sesión no completada'};
  if(!validDate(date)||rawDate.length>30||!kind)return {...info,status:'skipped',reason:'Fecha o deporte no reconocido'};
  if(stress===null||stress<0||stress>5000)return {...info,status:'skipped',reason:'Sin TSS real válido'};
  if(hours===null||hours<=0||hours>48)return {...info,status:'skipped',reason:'Sin duración real válida'};
  return {...info,status:'ready'};
 });
 return {headers:rows[0],entries,recognized:entries.filter(e=>e.status==='ready').length,skipped:entries.filter(e=>e.status==='skipped').length};
}
const NUM=x=>x!==null&&x!==undefined&&String(x).trim()!==''&&Number.isFinite(Number(x))?Number(x):null;
export function compareTrainingPeaks({entries,activities=[],metrics=[]}){
 if(!Array.isArray(entries)||!Array.isArray(activities)||!Array.isArray(metrics))throw new Error('Datos de comparación inválidos.');
 const byDate=new Map(),byId=new Map(metrics.map(m=>[m.activity_id,m]));
 for(const a of activities){
  const date=activityCalendarDate(a.started_at),sport=a.sport,seconds=NUM(a.duration_seconds);
  if(!validDate(date)||!sport||seconds===null||seconds<=0)continue;
  const key=date+'|'+sport;const list=byDate.get(key)||[];list.push(a);byDate.set(key,list);
 }
 const results=entries.map(e=>{
  if(e.status!=='ready')return {...e,status:'skipped'};
  const options=(byDate.get(e.date+'|'+e.sport)||[]).filter(a=>{
   const dur=NUM(a.duration_seconds);
   return dur!==null&&Math.abs(dur-e.seconds)<=Math.min(600,Math.max(180,e.seconds*.05));
  });
  if(options.length===0)return {...e,status:'unmatched'};
  if(options.length!==1)return {...e,status:'ambiguous',reason:'Varias actividades posibles'};
  return {...e,status:'candidate',activityId:options[0].id,activityTitle:options[0].title||'',durationDifference:Math.abs(Number(options[0].duration_seconds)-e.seconds)};
 });
 const collisions=new Map();
 for(const e of results)if(e.status==='candidate')collisions.set(e.activityId,(collisions.get(e.activityId)||0)+1);
 for(const e of results){
  if(e.status!=='candidate')continue;
  if(collisions.get(e.activityId)!==1){e.status='ambiguous';e.reason='Más de una fila CSV para la misma actividad';delete e.activityId;continue;}
  const metric=byId.get(e.activityId),garmin=NUM(metric?.tss);
  e.garminTss=garmin;e.garminSource=metric?.tss_source||'Sin TSS disponible';
  if(garmin===null){e.status='missing';continue;}
  e.difference=Math.round((garmin-e.tss)*100)/100;
  e.status=Math.abs(e.difference)<=Math.max(5,e.tss*.05)?'comparable':'different';
 }
 const counts={comparable:0,different:0,missing:0,ambiguous:0,unmatched:0,skipped:0};
 for(const e of results)counts[e.status]++;
 return {counts,results,total:results.length,withRealTss:results.length-counts.skipped,
  status:'Solo comparación local: no se han importado ni modificado valores.'};
}
