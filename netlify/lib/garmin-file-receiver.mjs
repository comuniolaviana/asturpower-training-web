import {fetchGarminOriginalOnce,GarminFileError} from './garmin-original-file.mjs';
import {digest,GarminError} from './garmin-protocol.mjs';
import {sha256,originalIdentity,originalChunkPath,ORIGINAL_CHUNK_BYTES} from '../../app/src/garmin-original-vault.js';
const checked=r=>{if(r.error)throw new GarminError('file_storage_unavailable');return r.data;};
export async function receiveGarminFile({db,event,connection,receivedAt,accessToken,fetcher=fetch}){
 // Reject a missing connection token before reserving the one-use Garmin callback.
 if(typeof accessToken!=='string'||accessToken.length<10||accessToken.length>20000||/\s|[\x00-\x1f\x7f]/.test(accessToken))
  throw new GarminError('garmin_file_access_token_required',503);
 const owner=connection.athlete_id;
 const job=checked(await db.rpc('start_garmin_api_file',{p_owner:owner,p_user_id:event.userId,p_external_id:String(event.summary.activityId),p_callback_sha:digest(event.callbackURL),p_format:event.fileType,p_received_at:receivedAt,p_summary:event.summary}));
 if(!job?.download)return {status:job?.status||'skipped'};
 let bytes;
 try{bytes=await fetchGarminOriginalOnce(event.callbackURL,{fetcher,accessToken});}
 catch(error){
  const code=error instanceof GarminFileError?error.code:'garmin_file_download_outcome_uncertain';
  checked(await db.from('garmin_api_files').update({status:'uncertain',last_error:code,reserved_bytes:0}).eq('id',job.id).eq('status','downloading'));
  return {status:'uncertain'};
 }
 const chunks=[];
 for(let offset=0;offset<bytes.length;offset+=ORIGINAL_CHUNK_BYTES){const part=bytes.subarray(offset,offset+ORIGINAL_CHUNK_BYTES);chunks.push({sha256:await sha256(part),size:part.length});}
 const manifest={archive_id:await originalIdentity(chunks,bytes.length),byte_size:bytes.length,chunks};
 checked(await db.rpc('stage_garmin_api_original',{p_job:job.id,p_manifest:manifest}));
 const storage=db.storage.from('garmin-originals');
 for(let i=0;i<chunks.length;i++){
  const part=chunks[i],path=originalChunkPath(owner,manifest.archive_id,i,part.sha256),raw=bytes.subarray(i*ORIGINAL_CHUNK_BYTES,i*ORIGINAL_CHUNK_BYTES+part.size);
  let saved=false;
  for(let attempt=0;attempt<3&&!saved;attempt++){
   try{
    const response=await storage.upload(path,raw,{contentType:'application/octet-stream',upsert:false});
    if(!response.error){saved=true;break;}
    if([response.error.statusCode,response.error.code,response.error.error].some(v=>['409','23505','Duplicate','ResourceAlreadyExists'].includes(String(v)))){
     const prior=await storage.download(path);saved=!prior.error&&prior.data?.size===part.size&&await sha256(await prior.data.arrayBuffer())===part.sha256;
    }
   }catch{/* Retry storage from memory, never the single-use provider GET. */}
  }
  if(!saved)throw new GarminError('file_storage_upload_pending');
 }
 checked(await db.rpc('finish_garmin_api_original',{p_job:job.id}));
 return {status:'stored'};
}
