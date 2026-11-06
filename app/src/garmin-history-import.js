// Import of user-provided Garmin export summaries from an existing private vault.
// Storage chunks are read on demand, SHA-256 verified, and never republished.
import {zipEntries,unzipEntry} from './garmin-original-zip.js';
import {originalChunkPath,originalIdentity,sha256,ORIGINAL_CHUNK_BYTES,ORIGINAL_BUDGET_BYTES} from './garmin-original-vault.js';

const SUMMARY_PATH=/^DI_CONNECT\/DI-Connect-Fitness\/[^/]+_\d+_summarizedActivities\.json$/i;
const MAX_SUMMARIES=25000;
const MAX_JSON_BYTES=12*1024*1024;
const SPORT_CODES={CYCLING:'cycling',RUNNING:'running',SWIMMING:'swimming',WALKING:'walking',STRENGTH_TRAINING:'strength'};
const ACTIVITY_CODES={road_biking:'cycling',indoor_cycling:'cycling',cycling:'cycling',virtual_ride:'cycling',mountain_biking:'cycling',running:'running',trail_running:'running',street_running:'running',swimming:'swimming',walking:'walking',strength_training:'strength'};

function stopIfAborted(signal){if(signal?.aborted)throw new DOMException('Operación detenida','AbortError');}
function finite(value){return typeof value==='number'&&Number.isFinite(value)?value:null;}
function allowed(value,min,max,digits=0){const n=finite(value);return n===null||n<min||n>max?null:Number(n.toFixed(digits));}
function optional(value,divisor,min,max,digits=0){const n=finite(value);return n===null?null:allowed(n/divisor,min,max,digits);}
function summaryRow(activity,ownerId){
 if(!activity||typeof activity!=='object'||Array.isArray(activity))return null;
 const rawId=activity.activityId;
 if(!((typeof rawId==='number'&&Number.isSafeInteger(rawId)&&rawId>0)||(typeof rawId==='string'&&/^\d{1,18}$/.test(rawId))))return null;
 const external_id=String(rawId);
 const started=finite(activity.startTimeGmt)??finite(activity.beginTimestamp);
 const duration=finite(activity.duration);
 if(started===null||duration===null||duration<1000||duration>172800000)return null;
 const date=new Date(started);
 if(Number.isNaN(date.getTime())||date.getUTCFullYear()<1990||date.getTime()>Date.now()+86400000)return null;
 const title=String(activity.name||'Actividad Garmin').trim().slice(0,160)||'Actividad Garmin';
 const sport=SPORT_CODES[String(activity.sportType||'').toUpperCase()]||ACTIVITY_CODES[String(activity.activityType||'').toLowerCase()]||'other';
 const secs=Math.round(duration/1000);
 if(secs<1||secs>172800)return null;
 const distance=optional(activity.distance,100,0,10000000,2);
 const elevation=optional(activity.elevationGain,100,0,100000,2);
 const hr=optional(activity.avgHr,1,25,250,0);
 const watts=optional(activity.avgPower,1,0,3500,0);
 return {athlete_id:ownerId,source:'garmin_export',external_id,started_at:date.toISOString(),sport,title,duration_seconds:secs,distance_meters:distance,elevation_gain_meters:elevation,avg_heart_rate:hr,avg_power_watts:watts};
}

// Presents a read-only Blob-like API for the ZIP reader. Only the footer, central
// directory and compact summary JSON members are fetched, not every FIT.
export async function openPrivateGarminArchive(client,ownerId,archiveId,{signal,onProgress=()=>{}}={}){
 stopIfAborted(signal);
 const identity=await client.auth.getUser();
 if(identity.error||identity.data?.user?.id!==ownerId)throw new Error('La sesión ha cambiado. Vuelve a entrar en AsturPower.');
 const result=await client.from('garmin_original_archives').select('archive_id,filename,byte_size,status,chunks')
  .eq('owner_id',ownerId).eq('archive_id',archiveId).single();
 const row=result.data;
 if(result.error||!row||row.status!=='ready'||!Array.isArray(row.chunks)||row.chunks.length<1||row.chunks.length>200||
  !Number.isSafeInteger(row.byte_size)||row.byte_size<1||row.byte_size>ORIGINAL_BUDGET_BYTES||
  row.chunks.some((c,i)=>!/^[a-f0-9]{64}$/.test(c.sha256)||!Number.isInteger(c.size)||c.size<1||c.size>ORIGINAL_CHUNK_BYTES||(i<row.chunks.length-1&&c.size!==ORIGINAL_CHUNK_BYTES))||
  row.chunks.reduce((sum,c)=>sum+c.size,0)!==row.byte_size||await originalIdentity(row.chunks,row.byte_size)!==archiveId){
  throw new Error('La copia original todavía no está lista o no supera la comprobación del manifiesto.');
 }
 const bucket=client.storage.from('garmin-originals'),cache=new Map(),inflight=new Map();let transferred=0;
 async function chunk(index){
  stopIfAborted(signal);
  if(cache.has(index))return cache.get(index);
  if(inflight.has(index))return inflight.get(index);
  const loading=(async()=>{
   const part=row.chunks[index],path=originalChunkPath(ownerId,archiveId,index,part.sha256);
   const downloaded=await bucket.download(path);
   if(downloaded.error||!downloaded.data||downloaded.data.size!==part.size)throw new Error('No se ha podido leer un fragmento del archivo privado.');
   const bytes=new Uint8Array(await downloaded.data.arrayBuffer());
   if(await sha256(bytes)!==part.sha256)throw new Error('La comprobación SHA-256 de un fragmento ha fallado. Se ha detenido la lectura.');
   stopIfAborted(signal);transferred+=bytes.length;onProgress({stage:'reading',done:transferred,total:row.byte_size});
   cache.set(index,bytes);if(cache.size>3)cache.delete(cache.keys().next().value);
   return bytes;
  })();inflight.set(index,loading);
  try{return await loading;}finally{inflight.delete(index);}
 }
 async function readRange(start,end){
  stopIfAborted(signal);
  if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<0||end<start||end>row.byte_size||end-start>32*1024*1024)
   throw new Error('El rango de lectura ZIP no es válido.');
  const result=new Uint8Array(end-start);
  for(let at=start;at<end;){
   const index=Math.floor(at/ORIGINAL_CHUNK_BYTES),part=await chunk(index);
   const offset=at-index*ORIGINAL_CHUNK_BYTES,count=Math.min(end-at,part.length-offset);
   if(count<=0)throw new Error('Fragmento fuera del tamaño esperado.');
   result.set(part.subarray(offset,offset+count),at-start);at+=count;
  }
  return result;
 }
 const blob={size:row.byte_size,slice(start=0,end=row.byte_size){
  const from=Math.max(0,Math.min(row.byte_size,Math.trunc(start))),to=Math.max(from,Math.min(row.byte_size,Math.trunc(end)));
  return {size:to-from,async arrayBuffer(){return (await readRange(from,to)).buffer;},
   stream(){return new ReadableStream({async start(controller){try{controller.enqueue(await readRange(from,to));controller.close();}catch(error){controller.error(error);}}});}};
 }};
 return {blob,filename:row.filename};
}

export async function previewGarminHistory(client,ownerId,archiveId,{signal,onProgress=()=>{}}={}){
 const {blob}=await openPrivateGarminArchive(client,ownerId,archiveId,{signal,onProgress});
 const entries=(await zipEntries(blob)).filter(entry=>SUMMARY_PATH.test(entry.name)).sort((a,b)=>a.name.localeCompare(b.name));
 if(!entries.length)throw new Error('Este ZIP no contiene resúmenes de actividades Garmin. Selecciona la exportación completa, no un paquete FIT individual.');
 if(entries.length>500)throw new Error('La exportación contiene demasiados archivos de resumen.');
 const records=new Map();let skipped=0,duplicates=0,seen=0;
 for(let i=0;i<entries.length;i++){
  stopIfAborted(signal);
  if(entries[i].size>MAX_JSON_BYTES)throw new Error('Un archivo de resumen es demasiado grande para este importador.');
  const bytes=await unzipEntry(blob,entries[i],MAX_JSON_BYTES);
  let parsed;try{parsed=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}
  catch{throw new Error('Uno de los resúmenes JSON no se puede interpretar. No se ha importado nada.');}
  const list=Array.isArray(parsed)&&parsed.length===1?parsed[0]?.summarizedActivitiesExport:null;
  if(!Array.isArray(list))throw new Error('Estructura inesperada del resumen Garmin. No se ha importado nada.');
  if(seen+list.length>MAX_SUMMARIES)throw new Error('Este historial supera el número de actividades permitido en una importación.');
  for(const activity of list){
   seen++;const row=summaryRow(activity,ownerId);
   if(!row){skipped++;continue;}
   if(records.has(row.external_id)){duplicates++;continue;}
   records.set(row.external_id,row);
  }
  onProgress({stage:'parsing',done:i+1,total:entries.length});
 }
 const rows=[...records.values()].sort((a,b)=>a.started_at.localeCompare(b.started_at));
 return {rows,seen,skipped,duplicates,earliest:rows[0]?.started_at||null,latest:rows.at(-1)?.started_at||null};
}

export async function saveGarminHistory(client,ownerId,rows,{signal,onProgress=()=>{}}={}){
 const identity=await client.auth.getUser();
 if(identity.error||identity.data?.user?.id!==ownerId)throw new Error('La sesión ha cambiado. Vuelve a entrar antes de importar.');
 if(!Array.isArray(rows)||rows.length<1||rows.length>MAX_SUMMARIES||rows.some(r=>r.athlete_id!==ownerId||r.source!=='garmin_export'))
  throw new Error('La vista previa del historial no es válida.');
 let imported=0,existing=0;
 for(let at=0;at<rows.length;at+=100){
  stopIfAborted(signal);
  const batch=rows.slice(at,at+100),ids=batch.map(r=>r.external_id);
  const check=await client.from('activities').select('external_id,source').eq('athlete_id',ownerId)
   .in('source',['garmin_export','garmin_api']).in('external_id',ids);
  if(check.error||!Array.isArray(check.data))throw new Error('No se pudieron comprobar los duplicados. Lo ya importado se conserva; puedes reanudar.');
  const known=new Set(check.data.map(r=>r.external_id));
  const unseen=batch.filter(r=>!known.has(r.external_id));existing+=batch.length-unseen.length;
  if(unseen.length){
   const result=await client.from('activities').insert(unseen);
   if(result.error)throw new Error('La importación se ha detenido al guardar actividades. Lo ya importado permanece; vuelve a intentarlo para continuar sin duplicados.');
   imported+=unseen.length;
  }
  onProgress({stage:'saving',done:Math.min(at+100,rows.length),total:rows.length});
 }
 return {imported,existing,total:rows.length};
}
