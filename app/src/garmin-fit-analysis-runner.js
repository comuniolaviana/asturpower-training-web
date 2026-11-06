// Athlete-initiated and resumable browser process; no background service, no secret key.
import {loadFullCatalog} from './garmin-full-catalog.js';
import {openPrivateGarminArchive} from './garmin-history-import.js';
import {zipEntries,unzipEntry} from './garmin-original-zip.js';
import {analyzeFitBytes,matchFitActivity,derivedFitRow,resolveHistoricalTss} from './garmin-fit-analysis.js';

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
export async function readAnalysisSummary(client,ownerId,archiveId){
 await assertOwner(client,ownerId);
 const [analysis,progress,physiology]=await Promise.all([
  allRows(()=>client.from('garmin_fit_analysis').select('activity_id,sport,normalized_power_watts,tss,fit_started_at,power_coverage,duration_seconds').eq('athlete_id',ownerId).eq('archive_id',archiveId).order('fit_started_at',{ascending:false})),
  client.from('garmin_fit_scan_progress').select('pack_name,next_index,scanned,linked').eq('athlete_id',ownerId).eq('archive_id',archiveId).limit(24),
  client.from('athlete_physiology').select('sport,effective_date,ftp,created_at').eq('athlete_id',ownerId).eq('sport','cycling').order('effective_date',{ascending:false}).limit(500),
 ]);
 if(progress.error||physiology.error)throw new Error('No se pudo consultar el progreso o el FTP histórico del analizador FIT.');
 return {analysis:analysis.map(row=>resolveHistoricalTss(row,physiology.data||[])),progress:progress.data||[]};
}
export async function processGarminFitArchive(client,ownerId,archiveId,{signal,onProgress=()=>{}}={}){
 canceled(signal);await assertOwner(client,ownerId);
 const catalog=await loadFullCatalog(client,ownerId,archiveId);
 if(!catalog.length)throw new Error('Primero crea el índice de archivos Garmin.');
 const activities=await allRows(()=>client.from('activities')
  .select('id,started_at,sport,duration_seconds,distance_meters,external_id')
  .eq('athlete_id',ownerId).in('source',['garmin_export','garmin_api']).order('started_at',{ascending:true}));
 const ftpResult=await client.from('athlete_physiology').select('sport,effective_date,ftp,created_at')
  .eq('athlete_id',ownerId).eq('sport','cycling').order('effective_date',{ascending:false}).limit(500);
 if(ftpResult.error)throw new Error('No se han podido consultar los FTP históricos.');
 const ftpVersions=ftpResult.data||[],summary=await readAnalysisSummary(client,ownerId,archiveId);
 const progressByPack=new Map(summary.progress.map(x=>[x.pack_name,x]));
 const knownActivityIds=new Set(summary.analysis.map(x=>x.activity_id));
 const {blob}=await openPrivateGarminArchive(client,ownerId,archiveId,{signal});
 const outer=await zipEntries(blob),outerMap=new Map(outer.map(x=>[x.name,x]));
 const totalFitFiles=catalog.reduce((n,pack)=>n+pack.entries.filter(e=>e.kind==='FIT').length,0);
 let processedFitFiles=summary.progress.reduce((n,r)=>n+r.scanned,0);
 let linked=0,errors=0,withNp=0,withTss=0;
 for(let packIndex=0;packIndex<catalog.length;packIndex++){
  canceled(signal);await assertOwner(client,ownerId);
  const pack=catalog[packIndex],entry=outerMap.get(pack.pack_name);
  if(!entry||entry.size>MAX_PACK_BYTES)throw new Error('No se encuentra un paquete original del catálogo.');
  const previous=progressByPack.get(pack.pack_name),start=previous?.next_index||0;
  const fitFiles=pack.entries.filter(e=>e.kind==='FIT');
  if(start>=fitFiles.length)continue;
  onProgress({stage:'pack',pack:packIndex+1,packages:catalog.length,done:processedFitFiles,total:totalFitFiles,linked,withNp,withTss});
  const packBytes=await unzipEntry(blob,entry,MAX_PACK_BYTES);
  const localBlob=new Blob([packBytes]);
  const entries=await zipEntries(localBlob),entryMap=new Map(entries.map(e=>[e.name,e]));
  let alreadyLinked=previous?.linked||0,checked=previous?.scanned||0;
  async function checkpoint(index){
   canceled(signal);
   const value={athlete_id:ownerId,archive_id:archiveId,pack_name:pack.pack_name,
    next_index:index,scanned:checked,linked:alreadyLinked,updated_at:new Date().toISOString()};
   const saved=await client.from('garmin_fit_scan_progress').upsert(value,{onConflict:'athlete_id,archive_id,pack_name'});
   if(saved.error)throw new Error('No se pudo guardar el avance del analizador. Las actividades ya vinculadas se conservan.');
  }
  for(let i=start;i<fitFiles.length;i++){
   canceled(signal);
   const info=fitFiles[i],file=entryMap.get(info.name);
   let analysis=null;
   if(file&&file.size>=512&&file.size<=MAX_FILE_BYTES){
    try{
     const raw=await unzipEntry(localBlob,file,MAX_FILE_BYTES);
     analysis=analyzeFitBytes(raw);
    }catch{errors++;} // Bad/unsupported FIT cannot corrupt the batch.
   }
   if(analysis){
    const matched=matchFitActivity(analysis,activities);
    if(matched&&!knownActivityIds.has(matched.activity.id)){
     const row=derivedFitRow(analysis,matched,ftpVersions,{
      athleteId:ownerId,archiveId,packName:pack.pack_name,fileName:info.name});
     if(row){
      const saved=await client.from('garmin_fit_analysis').insert(row);
      if(saved.error)throw new Error('No se pudo guardar la vinculación FIT de forma segura. Puedes reanudar el proceso.');
      knownActivityIds.add(row.activity_id);
      linked++;alreadyLinked++;
      if(row.normalized_power_watts!==null)withNp++;
      if(row.tss!==null)withTss++;
     }
    }
   }
   checked++;processedFitFiles++;
   if((i+1)%25===0||i+1===fitFiles.length){
    await checkpoint(i+1);
    onProgress({stage:'scanning',pack:packIndex+1,packages:catalog.length,done:processedFitFiles,total:totalFitFiles,linked,withNp,withTss,errors});
    // Let the browser repaint and let the user stop a long seven-pack scan.
    await new Promise(resolve=>setTimeout(resolve,0));
   }
  }
 }
 return {scanned:processedFitFiles,total:totalFitFiles,newLinks:linked,newNormalizedPower:withNp,newTss:withTss,unsupported:errors,missingFtp:ftpVersions.every(x=>x.ftp==null)};
}
