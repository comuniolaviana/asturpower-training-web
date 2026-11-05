// All original bytes are retained. The manifest hashes ordered 4 MiB chunks.
// User JWT + Storage RLS only. No privileged key or public/signed download URL.
export const ORIGINAL_BUCKET='garmin-originals';
export const ORIGINAL_CHUNK_BYTES=4*1024*1024;
export const ORIGINAL_BUDGET_BYTES=800*1024*1024;
const HEX=/^[a-f0-9]{64}$/;
function cancelled(signal){if(signal?.aborted)throw new DOMException('Operación detenida','AbortError');}
export async function sha256(bytes){
 return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
}
export async function originalIdentity(chunks,byteSize){
 const ordered=chunks.map(c=>({sha256:c.sha256,size:c.size}));
 return sha256(new TextEncoder().encode(JSON.stringify({version:1,byte_size:byteSize,chunks:ordered})));
}
export async function describeOriginal(file,{signal,onProgress=()=>{}}={}){
 if(!file||!Number.isSafeInteger(file.size)||file.size<1)throw new Error('Selecciona un archivo original que no esté vacío.');
 if(file.size>ORIGINAL_BUDGET_BYTES)throw new Error('El archivo completo supera el espacio reservado del plan gratuito. No se recortará ni se subirá parcialmente; conserva el original para revisar el almacenamiento.');
 const chunks=[];
 for(let offset=0;offset<file.size;offset+=ORIGINAL_CHUNK_BYTES){
  cancelled(signal);
  const bytes=await file.slice(offset,offset+ORIGINAL_CHUNK_BYTES).arrayBuffer();
  chunks.push({sha256:await sha256(bytes),size:bytes.byteLength});
  onProgress({stage:'checking',done:Math.min(offset+bytes.byteLength,file.size),total:file.size});
 }
 cancelled(signal);
 return {archive_id:await originalIdentity(chunks,file.size),byte_size:file.size,chunks};
}
export function originalChunkPath(ownerId,archiveId,index,hash){
 if(!/^[a-f0-9-]{36}$/i.test(ownerId)||!HEX.test(archiveId)||!Number.isInteger(index)||index<0||index>199||!HEX.test(hash))
  throw new Error('El identificador del archivo no es válido.');
 return ownerId+'/'+archiveId+'/'+String(index).padStart(6,'0')+'-'+hash+'.bin';
}
async function ownSession(client,ownerId){
 const result=await client.auth.getUser();
 if(result.error||result.data?.user?.id!==ownerId)throw new Error('Tu sesión ha cambiado. Vuelve a entrar en tu cuenta antes de continuar.');
}
function rpcValue(result){return Array.isArray(result.data)?result.data[0]:result.data;}
export async function uploadOriginal(client,ownerId,file,{signal,onProgress=()=>{}}={}){
 await ownSession(client,ownerId);
 const manifest=await describeOriginal(file,{signal,onProgress});
 cancelled(signal);await ownSession(client,ownerId);
 const filename=String(file.name||'original-garmin').slice(0,255);
 const reserved=await client.rpc('reserve_garmin_original',{
  p_archive_id:manifest.archive_id,p_filename:filename,p_byte_size:manifest.byte_size,p_chunks:manifest.chunks,p_consent:true,
 });
 if(reserved.error){
  if(reserved.error.code==='54000')throw new Error('No hay espacio suficiente para conservar este archivo completo en el plan gratuito. No se ha iniciado su subida.');
  throw new Error('No se pudo reservar el archivo en tu cuenta. No se ha iniciado su subida.');
 }
 const row=rpcValue(reserved);
 if(row?.archive_id!==manifest.archive_id)throw new Error('No se pudo comprobar la reserva del archivo.');
 if(row.status==='ready')return {...manifest,filename,already_saved:true};
 const bucket=client.storage.from(ORIGINAL_BUCKET);let uploaded=0;
 for(let i=0;i<manifest.chunks.length;i++){
  cancelled(signal);await ownSession(client,ownerId);cancelled(signal);
  const part=manifest.chunks[i],path=originalChunkPath(ownerId,manifest.archive_id,i,part.sha256);
  const bytes=file.slice(i*ORIGINAL_CHUNK_BYTES,i*ORIGINAL_CHUNK_BYTES+part.size);
  const result=await bucket.upload(path,bytes,{upsert:false,contentType:'application/octet-stream',cacheControl:'0'});
  if(result.error){
   if(![result.error.statusCode,result.error.code,result.error.error].some(v=>['409','Duplicate','ResourceAlreadyExists'].includes(String(v))))
    throw new Error('La subida se ha interrumpido. Conserva el original y vuelve a seleccionarlo para reanudar.');
   const existing=await bucket.download(path);
   if(existing.error||!existing.data||existing.data.size!==part.size||await sha256(await existing.data.arrayBuffer())!==part.sha256)
    throw new Error('Un fragmento existente no coincide con el original. La subida se ha detenido sin sustituirlo.');
  }
  uploaded+=part.size;onProgress({stage:'uploading',done:uploaded,total:manifest.byte_size});
 }
 cancelled(signal);await ownSession(client,ownerId);
 const completed=await client.rpc('complete_garmin_original',{p_archive_id:manifest.archive_id});
 if(completed.error||rpcValue(completed)?.status!=='ready')throw new Error('Los fragmentos se han enviado, pero falta confirmar el archivo completo. Vuelve a seleccionar el original para reanudar.');
 return {...manifest,filename,already_saved:false};
}
export async function listOriginals(client,ownerId){
 await ownSession(client,ownerId);
 const result=await client.from('garmin_original_archives')
  .select('archive_id,filename,byte_size,status,created_at').eq('owner_id',ownerId)
  .order('created_at',{ascending:false}).limit(100);
 if(result.error||!Array.isArray(result.data))throw new Error('No se pudieron consultar los originales.');
 return result.data;
}
export async function downloadOriginal(client,ownerId,archiveId,{signal,onProgress=()=>{},onChunk=null}={}){
 await ownSession(client,ownerId);
 const result=await client.from('garmin_original_archives').select('archive_id,filename,byte_size,chunks,status')
  .eq('owner_id',ownerId).eq('archive_id',archiveId).single();
 const row=result.data;
 if(result.error||!row||row.status!=='ready'||!Array.isArray(row.chunks)||row.chunks.length>200||
  !Number.isSafeInteger(row.byte_size)||row.byte_size<1||row.byte_size>ORIGINAL_BUDGET_BYTES||
  row.chunks.some(c=>!HEX.test(c.sha256)||!Number.isInteger(c.size)||c.size<1||c.size>ORIGINAL_CHUNK_BYTES)||
  row.chunks.reduce((n,c)=>n+c.size,0)!==row.byte_size||await originalIdentity(row.chunks,row.byte_size)!==archiveId)
  throw new Error('El archivo completo todavía no está disponible o su manifiesto no es válido.');
 const parts=[];let done=0;
 for(let i=0;i<row.chunks.length;i++){
  cancelled(signal);await ownSession(client,ownerId);
  const part=row.chunks[i],path=originalChunkPath(ownerId,archiveId,i,part.sha256);
  const downloaded=await client.storage.from(ORIGINAL_BUCKET).download(path);
  if(downloaded.error||!downloaded.data||downloaded.data.size!==part.size)
   throw new Error('No se pudo recuperar un fragmento completo. La descarga no está terminada.');
  const bytes=await downloaded.data.arrayBuffer();
  if(await sha256(bytes)!==part.sha256)throw new Error('Un fragmento no supera la comprobación de integridad. No se entregará un archivo alterado.');
  if(onChunk)await onChunk(bytes);else parts.push(bytes);
  done+=bytes.byteLength;onProgress({stage:'downloading',done,total:row.byte_size});
 }
 cancelled(signal);return {blob:onChunk?null:new Blob(parts,{type:'application/octet-stream'}),filename:row.filename};
}
