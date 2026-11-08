import {createClient} from 'npm:@supabase/supabase-js@2.118.0';
import {processApiFile} from '../_shared/garmin-file-analysis.js';
const response=(body:unknown,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'no-store'}});
Deno.serve(async(req:Request)=>{
 if(req.method!=='POST')return response({error:'method_not_allowed'},405);
 try{
  if(Number(req.headers.get('content-length'))>4096)return response({error:'invalid_request'},400);
  const reader=req.body?.getReader();if(!reader)return response({error:'invalid_request'},400);
  const parts:Uint8Array[]=[];let size=0;
  try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>4096)return response({error:'invalid_request'},400);parts.push(value);}}finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
  const bytes=new Uint8Array(size);let at=0;for(const part of parts){bytes.set(part,at);at+=part.length;}const raw=new TextDecoder().decode(bytes);
  const body=JSON.parse(raw),signature=req.headers.get('x-asturpower-hook');
  if(body.kind!=='garmin-api-file'||typeof body.job_id!=='string'||!/^[0-9a-f-]{36}$/.test(body.job_id)||!Number.isSafeInteger(body.sent_at)||Math.abs(Date.now()/1000-body.sent_at)>300||!signature||!/^[0-9a-f]{64}$/.test(signature))return response({error:'unauthorized'},401);
  const db=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false,autoRefreshToken:false},global:{fetch:(url,init)=>fetch(url,{...init,signal:AbortSignal.timeout(15000)})}});
  const config=await db.rpc('server_push_config');if(config.error||!config.data?.hook_secret)throw Error();
  const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(config.data.hook_secret),{name:'HMAC',hash:'SHA-256'},false,['verify']);
  if(!await crypto.subtle.verify('HMAC',key,Uint8Array.from(signature.match(/../g)!,x=>parseInt(x,16)),new TextEncoder().encode(raw)))return response({error:'unauthorized'},401);
  const claim=await db.rpc('claim_garmin_api_file',{p_job:body.job_id});if(claim.error)throw Error();
  if(claim.data){const job=claim.data;EdgeRuntime.waitUntil(processApiFile(db,job).catch(async(error:Error)=>{
   const safe=new Set(['source_format_requires_review','session_requires_review','file_activity_mismatch','connection_changed','original_manifest_invalid','original_integrity_failed','analysis_requires_review','existing_detail_requires_review','existing_series_requires_review','series_size_limit','series_integrity_failed']);
   const code=safe.has(error.message)?error.message:'processing_interrupted';
   await db.from('garmin_api_files').update({status:job.attempts>=5?'error':'stored',last_error:code,lease_token:null,lease_until:null,updated_at:new Date().toISOString()}).eq('id',job.id).eq('lease_token',job.lease_token);
  }));}
  return response({accepted:true},202);
 }catch{return response({error:'temporarily_unavailable'},503);}
});
