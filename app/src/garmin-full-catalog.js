// Every original byte remains in the owner-only private ZIP.
// This module indexes names and sizes so the complete FIT/TCX/GPX collection
// is discoverable without duplicating 600+ MB of extracted binaries.
import {openPrivateGarminArchive} from './garmin-history-import.js';
import {zipEntries,unzipEntry} from './garmin-original-zip.js';
const MAX_PACK=64*1024*1024;
const MAX_FILE=50*1024*1024;
const MAX_PACKS=24;
const NAME_RE=/^DI_CONNECT\/DI-Connect-Uploaded-Files\/[^/]+\.zip$/i;
function assertSession(result,ownerId){
 if(result.error||result.data?.user?.id!==ownerId)throw new Error('Sesión modificada. Entra de nuevo antes de consultar tus originales.');
}
function stop(signal){if(signal?.aborted)throw new DOMException('Operación detenida','AbortError');}
export function fileKind(name){
 const ext=String(name).split('.').at(-1).toLowerCase();
 return ['fit','tcx','gpx'].includes(ext)?ext.toUpperCase():'OTRO';
}
export async function loadFullCatalog(client,ownerId,archiveId){
 assertSession(await client.auth.getUser(),ownerId);
 const result=await client.from('garmin_original_catalog')
  .select('pack_name,entries,indexed_at').eq('owner_id',ownerId)
  .eq('archive_id',archiveId).order('pack_name',{ascending:true}).limit(MAX_PACKS);
 if(result.error||!Array.isArray(result.data))throw new Error('No se ha podido consultar el índice privado.');
 return result.data.filter(row=>Array.isArray(row.entries)&&row.entries.length<=5000&&typeof row.pack_name==='string');
}
export async function buildFullCatalog(client,ownerId,archiveId,{signal,onProgress=()=>{}}={}){
 stop(signal);assertSession(await client.auth.getUser(),ownerId);
 const ready=await loadFullCatalog(client,ownerId,archiveId),done=new Set(ready.map(x=>x.pack_name));
 const original=await openPrivateGarminArchive(client,ownerId,archiveId,{signal,onProgress});
 const outer=await zipEntries(original.blob);
 const packs=outer.filter(e=>NAME_RE.test(e.name)).sort((a,b)=>a.name.localeCompare(b.name));
 if(!packs.length)throw new Error('Este ZIP no contiene paquetes Garmin con FIT, TCX o GPX.');
 if(packs.length>MAX_PACKS)throw new Error('Hay demasiados paquetes internos para una importación segura.');
 let files=ready.reduce((n,r)=>n+r.entries.length,0);
 for(let i=0;i<packs.length;i++){
  stop(signal);
  const part=packs[i];
  if(done.has(part.name)){onProgress({stage:'indexing',done:i+1,total:packs.length,files});continue;}
  if(part.size<1||part.size>MAX_PACK)throw new Error('Un paquete supera el límite de lectura segura. El ZIP original permanece intacto.');
  onProgress({stage:'package',name:part.name,done:i,total:packs.length,files});
  const bytes=await unzipEntry(original.blob,part,MAX_PACK);
  stop(signal);
  const nested=await zipEntries(new Blob([bytes]));
  if(nested.length>5000)throw new Error('Un paquete contiene demasiadas entradas para el índice.');
  const entries=nested.map(e=>({name:e.name,byte_size:e.size,kind:fileKind(e.name)}));
  const saved=await client.from('garmin_original_catalog').upsert({
   owner_id:ownerId,archive_id:archiveId,pack_name:part.name,entries,
  },{onConflict:'owner_id,archive_id,pack_name'});
  if(saved.error)throw new Error('No se ha podido guardar el índice privado. Los paquetes ya indexados se conservan para reanudar.');
  files+=entries.length;onProgress({stage:'indexing',done:i+1,total:packs.length,files});
 }
 return loadFullCatalog(client,ownerId,archiveId);
}
export async function readFullCatalogFile(client,ownerId,archiveId,packName,fileName,{signal,cache=null,onProgress=()=>{}}={}){
 stop(signal);assertSession(await client.auth.getUser(),ownerId);
 // A checked catalogue row is an index, not permission to fetch arbitrary bytes.
 const catalog=await client.from('garmin_original_catalog').select('pack_name,entries')
  .eq('owner_id',ownerId).eq('archive_id',archiveId).eq('pack_name',packName).single();
 if(catalog.error||!catalog.data||!Array.isArray(catalog.data.entries)||
  !catalog.data.entries.some(e=>e.name===fileName))throw new Error('El archivo no figura en tu índice privado.');
 let pack;
 if(cache?.name===packName&&cache.blob)pack=cache.blob;
 else{
  const {blob}=await openPrivateGarminArchive(client,ownerId,archiveId,{signal,onProgress});
  const outer=(await zipEntries(blob)).find(e=>e.name===packName&&NAME_RE.test(e.name));
  if(!outer||outer.size<1||outer.size>MAX_PACK)throw new Error('El paquete original no está disponible.');
  pack=new Blob([await unzipEntry(blob,outer,MAX_PACK)]);
 }
 stop(signal);
 const item=(await zipEntries(pack)).find(e=>e.name===fileName);
 if(!item||item.size>MAX_FILE)throw new Error('El archivo original no se puede abrir con seguridad.');
 const raw=await unzipEntry(pack,item,MAX_FILE);
 stop(signal);
 return {blob:new Blob([raw]),name:fileName,packCache:{name:packName,blob:pack}};
}
