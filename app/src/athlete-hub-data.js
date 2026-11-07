import {requirePerformanceSession} from './performance-data.js';
import {validDate} from './performance.js';
export const WEIGHT_CONTEXTS={fasting:'En ayunas',before_power_test:'Antes de un test de potencia',before_hr_test:'Antes de un test de pulso',other:'Otro momento'};
export const todayMadrid=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Madrid',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const result=r=>{if(r.error)throw new Error('No se pudo consultar la información. Vuelve a intentarlo.');return r.data;};
export function validateWeight(v){
 const weight=Number(v.weight_kg),date=String(v.measured_on||''),context=String(v.context||'');
 if(!validDate(date)||date>todayMadrid())throw new Error('Selecciona una fecha válida, hasta hoy.');
 if(!Number.isFinite(weight)||weight<15||weight>400)throw new Error('Indica un peso entre 15 y 400 kg.');
 if(!WEIGHT_CONTEXTS[context])throw new Error('Selecciona cuándo te pesaste.');
 const note=String(v.note||'').trim();if(note.length>300)throw new Error('La nota admite 300 caracteres.');
 return {weight_kg:Math.round(weight*100)/100,measured_on:date,context,note,share_with_coach:v.share_with_coach===true};
}
export function weightStats(rows){
 if(!rows.length)return null;
 const sorted=[...rows].sort((a,b)=>a.measured_on.localeCompare(b.measured_on));
 return {first:sorted[0],last:sorted.at(-1),mean:sorted.reduce((s,r)=>s+Number(r.weight_kg),0)/sorted.length,change:Number(sorted.at(-1).weight_kg)-Number(sorted[0].weight_kg)};
}
export async function loadWeights(client,uid){
 await requirePerformanceSession(client,uid);const rows=[];
 for(let page=0;page<6;page++){
  const chunk=result(await client.from('athlete_weights').select('id,measured_on,weight_kg,context,note,share_with_coach').eq('athlete_id',uid).order('measured_on',{ascending:false}).order('id',{ascending:false}).range(page*1000,page*1000+999))||[];
  rows.push(...chunk);if(rows.length>5000||chunk.length<1000)break;
 }
 return rows.slice(0,5001);
}
export async function saveWeight(client,uid,values){const payload=validateWeight(values);await requirePerformanceSession(client,uid);return result(await client.from('athlete_weights').upsert({...payload,athlete_id:uid},{onConflict:'athlete_id,measured_on,context'}).select('id').single());}
export async function loadBasics(client,uid){await requirePerformanceSession(client,uid);return result(await client.from('athlete_basics').select('height_cm,birth_year,main_sport').eq('athlete_id',uid).maybeSingle());}
export async function saveBasics(client,uid,v){
 const height=v.height_cm===''?null:Number(v.height_cm),year=v.birth_year===''?null:Number(v.birth_year),sport=String(v.main_sport||'cycling');
 if(height!==null&&(!Number.isFinite(height)||height<80||height>250))throw new Error('La altura debe estar entre 80 y 250 cm.');
 if(year!==null&&(!Number.isInteger(year)||year<1900||year>Number(todayMadrid().slice(0,4))))throw new Error('Revisa el año de nacimiento.');
 if(!['cycling','running','swimming','other'].includes(sport))throw new Error('Selecciona tu deporte.');
 await requirePerformanceSession(client,uid);result(await client.from('athlete_basics').upsert({athlete_id:uid,height_cm:height,birth_year:year,main_sport:sport},{onConflict:'athlete_id'}));
}
export async function loadNews(client,uid,page=0){await requirePerformanceSession(client,uid);return result(await client.from('app_notifications').select('id,kind,event_date,title,message,occurred_at,read_at').eq('recipient_id',uid).order('occurred_at',{ascending:false}).order('id',{ascending:false}).range(page*20,page*20+19))||[];}
export async function unreadNews(client,uid){const r=await client.from('app_notifications').select('id',{count:'exact',head:true}).eq('recipient_id',uid).is('read_at',null);if(r.error)throw Error();return r.count||0;}
export async function readNews(client,uid,id){await requirePerformanceSession(client,uid);result(await client.from('app_notifications').update({read_at:new Date().toISOString()}).eq('id',id).eq('recipient_id',uid));}

export async function latestWeight(client,uid){await requirePerformanceSession(client,uid);return (result(await client.from('athlete_weights').select('measured_on,weight_kg,context').eq('athlete_id',uid).order('measured_on',{ascending:false}).order('id',{ascending:false}).limit(1))||[])[0]||null;}
