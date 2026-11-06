// Athlete-initiated and resumable browser process; no background service, no secret key.
import {loadFullCatalog} from './garmin-full-catalog.js';
import {openPrivateGarminArchive} from './garmin-history-import.js';
import {zipEntries,unzipEntry} from './garmin-original-zip.js';
import {analyzeFitBytes,analyzeFitDecoded,fitClassification,matchFitActivity,derivedFitRow,resolveHistoricalTss,FIT_ANALYSIS_VERSION} from './garmin-fit-analysis.js';
import {decodeCompleteFit} from './garmin-full-fit.js';
import {saveSportSeries,seriesDigest} from './garmin-sports-series.js';
import {decodeSportXml} from './garmin-xml-sports.js';

const MAX_PACK_BYTES=64*1024*1024,MAX_FILE_BYTES=50*1024*1024;
function canceled(signal){if(signal?.aborted)throw new DOMException('Análisis detenido','AbortError');}
async function assertOwner(client,ownerId){
 const auth=await client.auth.getUser();
 if(auth.error||auth.data?.user?.id!==ownerId)throw new Error('La sesión del deportista ha cambiado; se ha detenido el análisis.');
}
async function allRows(queryFactory){
 const data=[];
 for(let offset=0;offset<25000;offset+=500){
  const result=await queryFactory().range(offset,offset+499);
  if(result.error||!Array.isArray(result.data))throw new Error('No se pudieron consultar los datos deportivos autorizados.');
  data.push(...result.data);
  if(result.data.length<500)return data;
 }
 throw new Error('La consulta ha superado el límite de filas del analizador.');
}
export async function readAnalysisSummary(client,ownerId,archiveId,{includeDetails=false}={}){
 await assertOwner(client,ownerId);
 const [analysis,progress,physiology]=await Promise.all([
  allRows(()=>client.from('garmin_fit_analysis').select('activity_id,sport,normalized_power_watts,tss,fit_started_at,power_coverage,power_seconds,duration_seconds,source_file_key,np_method,device_intensity_factor,device_tss,device_ftp_watts').eq('athlete_id',ownerId).eq('archive_id',archiveId).order('fit_started_at',{ascending:false})),
  client.from('garmin_fit_scan_progress').select('pack_name,next_index,scanned,linked,processing_version').eq('athlete_id',ownerId).eq('archive_id',archiveId).limit(24),
  client.from('athlete_physiology').select('sport,effective_date,ftp,created_at').eq('athlete_id',ownerId).eq('sport','cycling').order('effective_date',{ascending:false}).limit(500),
 ]);
 if(progress.error||physiology.error)throw new Error('No se pudo consultar el progreso o el FTP histórico del analizador FIT.');
 const result={analysis:analysis.map(row=>resolveHistoricalTss(row,physiology.data||[])),progress:progress.data||[]};
 if(includeDetails){
  const [series,diagnostics]=await Promise.all([
   allRows(()=>client.from('garmin_activity_series').select('activity_id,status').eq('athlete_id',ownerId).eq('status','ready').order('activity_id')),
   allRows(()=>client.from('garmin_fit_diagnostics').select('file_key,file_name,pack_name,reason,activity_id').eq('athlete_id',ownerId).eq('archive_id',archiveId).order('file_key')),
  ]);result.series=series;result.diagnostics=diagnostics;
 }
 return result;
}
export async function processGarminFitArchive(client,ownerId,archiveId,{signal,onProgress=()=>{},includeDetails=false}={}){
 canceled(signal);await assertOwner(client,ownerId);
 const catalog=await loadFullCatalog(client,ownerId,archiveId);
 if(!catalog.length)throw new Error('Primero crea el índice de archivos Garmin.');
 const activities=await allRows(()=>client.from('activities')
  .select('id,started_at,sport,duration_seconds,distance_meters,external_id')
  .eq('athlete_id',ownerId).in('source',['garmin_export','garmin_api']).order('started_at',{ascending:true}));
 const ftpResult=await client.from('athlete_physiology').select('sport,effective_date,ftp,created_at')
  .eq('athlete_id',ownerId).eq('sport','cycling').order('effective_date',{ascending:false}).limit(500);
 if(ftpResult.error)throw new Error('No se han podido consultar los FTP históricos.');
 const ftpVersions=ftpResult.data||[],summary=await readAnalysisSummary(client,ownerId,archiveId,{includeDetails});
 const progressByPack=new Map(summary.progress.map(x=>[x.pack_name,x]));
 const knownActivityIds=new Set(summary.analysis.map(x=>x.activity_id));
 const knownMetrics=new Map(summary.analysis.map(x=>[x.activity_id,x]));
 const knownSeries=new Set((summary.series||[]).map(x=>x.activity_id));
 const processingVersion=includeDetails?FIT_ANALYSIS_VERSION:1;
 const {blob}=await openPrivateGarminArchive(client,ownerId,archiveId,{signal});
 const outer=await zipEntries(blob),outerMap=new Map(outer.map(x=>[x.name,x]));
 const accepts=e=>includeDetails?['FIT','TCX','GPX'].includes(e.kind):e.kind==='FIT';
 const totalFitFiles=catalog.reduce((n,pack)=>n+pack.entries.filter(accepts).length,0);
 let processedFitFiles=summary.progress.filter(r=>(r.processing_version||1)>=processingVersion).reduce((n,r)=>n+r.scanned,0);
 let linked=0,errors=0,withNp=0,withTss=0,seriesSaved=0,diagnostics=[];
 for(let packIndex=0;packIndex<catalog.length;packIndex++){
  canceled(signal);await assertOwner(client,ownerId);
  const pack=catalog[packIndex],entry=outerMap.get(pack.pack_name);
  if(!entry||entry.size>MAX_PACK_BYTES)throw new Error('No se encuentra un paquete original del catálogo.');
  const stored=progressByPack.get(pack.pack_name),previous=(stored?.processing_version||1)>=processingVersion?stored:null,start=previous?.next_index||0;
  const fitFiles=pack.entries.filter(accepts);
  if(start>=fitFiles.length)continue;
  onProgress({stage:'pack',pack:packIndex+1,packages:catalog.length,done:processedFitFiles,total:totalFitFiles,linked,withNp,withTss});
  const packBytes=await unzipEntry(blob,entry,MAX_PACK_BYTES);
  const localBlob=new Blob([packBytes]);
  const entries=await zipEntries(localBlob),entryMap=new Map(entries.map(e=>[e.name,e]));
  let alreadyLinked=previous?.linked||0,checked=previous?.scanned||0;
  async function checkpoint(index){
   canceled(signal);
   if(includeDetails&&diagnostics.length){
    const recorded=await client.from('garmin_fit_diagnostics').upsert(diagnostics,{onConflict:'athlete_id,archive_id,file_key'});
    if(recorded.error)throw new Error('No se pudo guardar el diagnóstico. El avance no se ha adelantado; puedes reanudar.');
    diagnostics=[];
   }
   const value={athlete_id:ownerId,archive_id:archiveId,pack_name:pack.pack_name,
    next_index:index,scanned:checked,linked:alreadyLinked,updated_at:new Date().toISOString(),...(includeDetails?{processing_version:FIT_ANALYSIS_VERSION}:{})};
   const saved=await client.from('garmin_fit_scan_progress').upsert(value,{onConflict:'athlete_id,archive_id,pack_name'});
   if(saved.error)throw new Error('No se pudo guardar el avance del analizador. Las actividades ya vinculadas se conservan.');
  }
  for(let i=start;i<fitFiles.length;i++){
   canceled(signal);
   const info=fitFiles[i],file=entryMap.get(info.name);
   const fileKey=includeDetails?await seriesDigest(new TextEncoder().encode(pack.pack_name+'\n'+info.name)):null;
   let analysis=null,decoded=null,reason='size_limit',activityId=null;
   if(file&&file.size>=14&&file.size<=MAX_FILE_BYTES){
    try{
     const raw=await unzipEntry(localBlob,file,MAX_FILE_BYTES);
     if(includeDetails){decoded=info.kind==='FIT'?decodeCompleteFit(raw,{allowPartial:true}):decodeSportXml(raw,info.kind);reason=fitClassification(decoded);analysis=analyzeFitDecoded(decoded);if(analysis)analysis.source_format=info.kind;}
     else analysis=analyzeFitBytes(raw);
    }catch{errors++;reason='unreadable';} // The original remains untouched.
   }
   if(analysis){
    const matched=matchFitActivity(analysis,activities);
    reason=matched?'already_linked':activities.filter(a=>matchFitActivity(analysis,[a])).length>1?'ambiguous_match':'no_match';
    activityId=matched?.activity.id||null;
    if(matched&&!knownActivityIds.has(matched.activity.id)){
     const row=derivedFitRow(analysis,matched,ftpVersions,{
      athleteId:ownerId,archiveId,packName:pack.pack_name,fileName:info.name});
     if(row){
      const saved=await client.from('garmin_fit_analysis').insert(row);
      if(saved.error)throw new Error('No se pudo guardar la vinculación FIT de forma segura. Puedes reanudar el proceso.');
      knownActivityIds.add(row.activity_id);
      knownMetrics.set(row.activity_id,{...row,source_file_key:fileKey});
      reason='linked';
      linked++;alreadyLinked++;
      if(row.normalized_power_watts!==null)withNp++;
      if(row.tss!==null)withTss++;
     }
    }
    const prior=knownMetrics.get(activityId),sameSource=!prior?.source_file_key||prior.source_file_key===fileKey;
    if(includeDetails&&matched&&knownActivityIds.has(activityId)&&sameSource){
     if(analysis.normalized_power_watts!==null||prior?.normalized_power_watts==null){
      const upgraded=await client.from('garmin_fit_analysis').update({normalized_power_watts:analysis.normalized_power_watts,power_seconds:analysis.power_seconds,power_coverage:Number(analysis.power_coverage.toFixed(4)),sample_count:analysis.sample_count,np_method:analysis.np_method,calculation_version:FIT_ANALYSIS_VERSION})
       .eq('athlete_id',ownerId).eq('activity_id',activityId);
      if(upgraded.error)throw new Error('No se pudo guardar la revisión de potencia normalizada.');
     }
     const device={};for(const key of ['device_intensity_factor','device_tss','device_ftp_watts'])if(analysis[key]!==null&&analysis[key]!==undefined)device[key]=analysis[key];
     if(Object.keys(device).length){const saved=await client.from('garmin_fit_analysis').update(device).eq('athlete_id',ownerId).eq('activity_id',activityId);if(saved.error)throw new Error('No se pudo conservar el IF/TSS registrado en Garmin. Puedes reanudar.');}
     if(!knownSeries.has(activityId)&&(decoded.messages.recordMesgs||[]).length){
      canceled(signal);await assertOwner(client,ownerId);
      await saveSportSeries(client,ownerId,activityId,decoded);knownSeries.add(activityId);seriesSaved++;
     }
     reason=knownSeries.has(activityId)?'series_saved':'linked';
    }
   }
   if(includeDetails)diagnostics.push({athlete_id:ownerId,archive_id:archiveId,file_key:fileKey,file_name:info.name,pack_name:pack.pack_name,reason:reason||'invalid_session',activity_id:activityId});
   checked++;processedFitFiles++;
   if((i+1)%25===0||i+1===fitFiles.length){
    await checkpoint(i+1);
    onProgress({stage:'scanning',pack:packIndex+1,packages:catalog.length,done:processedFitFiles,total:totalFitFiles,linked,withNp,withTss,errors,seriesSaved});
    // Let the browser repaint and let the user stop a long seven-pack scan.
    await new Promise(resolve=>setTimeout(resolve,0));
   }
  }
 }
 return {scanned:processedFitFiles,total:totalFitFiles,newLinks:linked,newNormalizedPower:withNp,newTss:withTss,unsupported:errors,seriesSaved,missingFtp:ftpVersions.every(x=>x.ftp==null)};
}
