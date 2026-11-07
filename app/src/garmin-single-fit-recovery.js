// Manual recovery for recent Garmin API summaries missing complete FIT data.
// Only the signed-in athlete explicitly selects an original FIT; no Garmin
// credentials, public links, guessed samples, or archive-wide coach access.
import {crc32,zipEntries,unzipEntry} from './garmin-original-zip.js';
import {decodeCompleteFit} from './garmin-full-fit.js';
import {analyzeFitDecoded,matchFitActivity,fitClassification} from './garmin-fit-analysis.js';
import {uploadOriginal} from './garmin-original-vault.js';
import {buildFullCatalog} from './garmin-full-catalog.js';
import {processGarminFitArchive} from './garmin-fit-analysis-runner.js';

export const MAX_RECOVERY_FIT_BYTES=50*1024*1024;
const ENCODER=new TextEncoder();
function zipStored(filename,payload){
 const name=ENCODER.encode(filename);
 if(name.length<1||name.length>65535||payload.length>MAX_RECOVERY_FIT_BYTES+65536)throw Error('Nombre o tamaño de FIT no permitido.');
 const local=30+name.length+payload.length,dir=46+name.length,bytes=new Uint8Array(local+dir+22),view=new DataView(bytes.buffer);
 const crc=crc32(payload);
 view.setUint32(0,0x04034b50,true);view.setUint16(4,20,true);view.setUint16(6,2048,true);
 view.setUint16(8,0,true);view.setUint32(14,crc,true);
 view.setUint32(18,payload.length,true);view.setUint32(22,payload.length,true);
 view.setUint16(26,name.length,true);
 bytes.set(name,30);bytes.set(payload,30+name.length);
 view.setUint32(local,0x02014b50,true);view.setUint16(local+4,20,true);
 view.setUint16(local+6,20,true);view.setUint16(local+8,2048,true);
 view.setUint32(local+16,crc,true);view.setUint32(local+20,payload.length,true);
 view.setUint32(local+24,payload.length,true);view.setUint16(local+28,name.length,true);
 bytes.set(name,local+46);
 const end=local+dir;view.setUint32(end,0x06054b50,true);
 view.setUint16(end+8,1,true);view.setUint16(end+10,1,true);
 view.setUint32(end+12,dir,true);view.setUint32(end+16,local,true);
 return bytes;
}
// Reuse the already audited private Garmin archive, catalog, and series pipeline.
// We do not alter or synthesize any FIT bytes; only put them in a ZIP envelope.
export function packageStandaloneFit(bytes){
 if(!(bytes instanceof Uint8Array)||bytes.length<14||bytes.length>MAX_RECOVERY_FIT_BYTES)
  throw Error('El archivo FIT está vacío o supera el límite de 50 MB.');
 const nested=zipStored('recuperada.fit',bytes);
 return zipStored('DI_CONNECT/DI-Connect-Uploaded-Files/Recuperacion.zip',nested);
}
async function assertAthlete(client,athleteId){
 const result=await client.auth.getUser();
 if(result.error||result.data?.user?.id!==athleteId)
  throw Error('Debes iniciar sesión como titular de la actividad para recuperar el FIT.');
}
function ensureActive(signal){if(signal?.aborted)throw new DOMException('Recuperación detenida','AbortError');}
export async function inspectRecentFit(client,athleteId,file,{signal}={}){
 ensureActive(signal);await assertAthlete(client,athleteId);
 if(!file||!/\.fit$/i.test(file.name||'')||file.size<14||file.size>MAX_RECOVERY_FIT_BYTES)
  throw Error('Selecciona el FIT original de una actividad (máximo 50 MB).');
 const bytes=new Uint8Array(await file.arrayBuffer());ensureActive(signal);
 const decoded=decodeCompleteFit(bytes,{allowPartial:true});
 const classification=fitClassification(decoded);
 if(classification)throw Error('No se puede asociar este FIT como una actividad completa: '+classification+'.');
 const analysis=analyzeFitDecoded(decoded);
 if(!analysis)throw Error('El FIT no contiene una sesión deportiva compatible.');
 const earliest=new Date(Date.parse(analysis.started_at)-180000).toISOString();
 const latest=new Date(Date.parse(analysis.started_at)+180000).toISOString();
 const result=await client.from('activities')
  .select('id,started_at,sport,duration_seconds,distance_meters,title,source')
  .eq('athlete_id',athleteId).in('source',['garmin_api','garmin_export'])
  .gte('started_at',earliest).lte('started_at',latest).limit(30);
 if(result.error||!Array.isArray(result.data))throw Error('No se pudieron comprobar tus actividades del calendario.');
 const match=matchFitActivity(analysis,result.data);
 if(!match||!match.activity)throw Error('Este FIT no coincide de forma única y segura con una actividad ya registrada. No se ha guardado nada.');
 const existing=await client.from('garmin_activity_series').select('activity_id,status')
  .eq('athlete_id',athleteId).eq('activity_id',match.activity.id).maybeSingle();
 if(existing.error)throw Error('No se pudo comprobar si la actividad ya tiene sus curvas.');
 if(existing.data?.status==='ready')throw Error('Esta actividad ya tiene curvas guardadas. No se sobrescriben.');
 const other=await client.from('garmin_fit_analysis').select('activity_id')
  .eq('athlete_id',athleteId).eq('activity_id',match.activity.id).maybeSingle();
 if(other.error)throw Error('No se pudo comprobar el detalle deportivo existente.');
 if(other.data)throw Error('Ya existe una fuente de análisis para esta actividad. Hay que revisar la recuperación sin sustituirla.');
 return {bytes,match:match.activity,analysis,records:decoded.messages.recordMesgs?.length||0};
}
export async function recoverRecentFit(client,athleteId,file,{consent=false,signal,onProgress=()=>{}}={}){
 if(consent!==true)throw Error('Necesitamos tu autorización expresa para conservar el FIT y preparar sus datos.');
 const checked=await inspectRecentFit(client,athleteId,file,{signal});
 ensureActive(signal);
 const storedFile=new Blob([packageStandaloneFit(checked.bytes)],{type:'application/zip'});
 Object.defineProperty(storedFile,'name',{value:'recuperacion-garmin-'+checked.match.started_at.slice(0,10)+'.zip'});
 onProgress('Guardando el FIT original dentro de tu archivo privado…');
 const original=await uploadOriginal(client,athleteId,storedFile,{signal});
 ensureActive(signal);onProgress('Indexando el FIT sin tocar el historial anterior…');
 await buildFullCatalog(client,athleteId,original.archive_id,{signal});
 ensureActive(signal);onProgress('Preparando muestras de pulso, potencia y cadencia…');
 const details=await processGarminFitArchive(client,athleteId,original.archive_id,{signal,includeDetails:true});
 // Check the actual target row; never report success solely from a job result.
 const answer=await client.from('garmin_activity_series').select('status')
  .eq('athlete_id',athleteId).eq('activity_id',checked.match.id).maybeSingle();
 if(answer.error||answer.data?.status!=='ready')
  throw Error('El FIT original se ha conservado, pero sus curvas todavía no están listas. La actividad sigue intacta y requiere revisión.');
 return {activity:checked.match,records:checked.records,details};
}
