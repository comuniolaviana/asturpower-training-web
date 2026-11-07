import {createClient} from 'npm:@supabase/supabase-js@2.118.0';
import {calculateEffortBests} from '../_shared/effort-records.js';
const ORIGIN='https://asturpower-garmin-dev.asturpower-training.workers.dev';
const cors={'Access-Control-Allow-Origin':ORIGIN,'Access-Control-Allow-Headers':'authorization, apikey, content-type, x-client-info','Access-Control-Allow-Methods':'POST, OPTIONS','Cache-Control':'no-store'};
const response=(v:unknown,status=200)=>Response.json(v,{status,headers:cors});
const uuid=(v:unknown)=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
async function validHook(raw:string,signature:string|null,secret:string,sentAt:unknown){
 if(!signature||!/^[0-9a-f]{64}$/.test(signature)||typeof sentAt!=='number'||!Number.isSafeInteger(sentAt)||Math.abs(Date.now()/1000-sentAt)>300)return false;
 const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['verify']);
 return crypto.subtle.verify('HMAC',key,Uint8Array.from(signature.match(/../g)!,x=>parseInt(x,16)),new TextEncoder().encode(raw));
}
async function bounded(stream:ReadableStream<Uint8Array>){
 const reader=stream.getReader(),parts:Uint8Array[]=[];let size=0;
 try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>64*1024*1024)throw Error('oversize');parts.push(value);}}
 finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
 const raw=new Uint8Array(size);let at=0;for(const p of parts){raw.set(p,at);at+=p.length;}return raw;
}
async function fetchCompressed(db:any,owner:string,item:any){
 try{
  if(!uuid(item.activity_id)||!/^[a-f0-9]{64}$/.test(item.sha256)||item.byte_size>4*1024*1024)throw Error();
  const {data:blob,error}=await db.storage.from('garmin-sports-series').download(owner+'/'+item.activity_id+'/'+item.sha256+'.gz');if(error||!blob)throw Error();
  const bytes=new Uint8Array(await blob.arrayBuffer());
  const sha=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(b=>b.toString(16).padStart(2,'0')).join('');
  if(bytes.length!==item.byte_size||sha!==item.sha256)throw Error();
  return bytes;
 }catch{return null;}
}
async function processBatch(db:any,owner:string){
 const {data:claim,error}=await db.rpc('claim_effort_batch',{p_owner:owner});if(error||!claim)return;
 const started=Date.now();
 try{
  // At most three compressed files in flight. Decode one at a time and persist
  // only the small results together, reducing network overhead and memory use.
  const downloads=new Map<number,Promise<Uint8Array|null>>(),savedRows:any[]=[];
  const prefetch=(i:number)=>{if(i<claim.items.length)downloads.set(i,fetchCompressed(db,owner,claim.items[i]));};
  for(let i=0;i<Math.min(3,claim.items.length);i++)prefetch(i);
  for(let i=0;i<claim.items.length;i++){
   if(Date.now()-started>70000)break;
   const item=claim.items[i],bytes=await downloads.get(i);downloads.delete(i);prefetch(i+3);
   let values:any={algorithm_version:1,bests:[],record_count:0,power_seconds:0,heart_rate_seconds:0,status:'error'};
   try{
    if(!bytes)throw Error();
    const raw=await bounded(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip')));
    values={...calculateEffortBests(JSON.parse(new TextDecoder().decode(raw))),status:'ready'};
   }catch{/* Missing/corrupt series remain explicit and retryable; no fabricated best. */}
   savedRows.push({...values,activity_id:item.activity_id,athlete_id:owner,source_sha:item.sha256,checked_at:new Date().toISOString()});
  }
  if(savedRows.length){const saved=await db.from('activity_effort_bests').upsert(savedRows,{onConflict:'activity_id'});if(saved.error)throw Error();}
  const finished=await db.rpc('finish_effort_batch',{p_owner:owner,p_token:claim.token});if(finished.error)throw Error();
 }catch{/* The existing five-minute scheduler resumes expired leases. No private data logged. */}
}
Deno.serve(async(req:Request)=>{
 if(req.headers.get('origin')&&req.headers.get('origin')!==ORIGIN)return response({error:'invalid_origin'},403);
 if(req.method==='OPTIONS')return new Response(null,{status:204,headers:cors});
 if(req.method!=='POST')return response({error:'method_not_allowed'},405);
 try{
  const raw=await req.text();if(raw.length>4096)return response({error:'invalid_request'},400);const body=JSON.parse(raw);
  const key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');if(!key)return response({error:'unavailable'},503);
  const db=createClient(Deno.env.get('SUPABASE_URL')!,key,{auth:{persistSession:false,autoRefreshToken:false},global:{fetch:(url,init)=>fetch(url,{...init,signal:AbortSignal.timeout(12000)})}});
  const {data:config,error}=await db.rpc('server_push_config');if(error||!config)throw Error();
  if(await validHook(raw,req.headers.get('x-asturpower-hook'),config.hook_secret,body.sent_at)){
   if(!uuid(body.owner_id))return response({error:'invalid_request'},400);
   EdgeRuntime.waitUntil(processBatch(db,body.owner_id));return response({accepted:true},202);
  }
  const token=req.headers.get('authorization')?.replace(/^Bearer /i,'');if(!token)return response({error:'unauthorized'},401);
  const verified=await db.auth.getUser(token);if(verified.error||!verified.data.user||verified.data.user.is_anonymous)return response({error:'unauthorized'},401);
  if(body.action!=='start')return response({error:'invalid_request'},400);
  const owner=verified.data.user.id;
  const roles=await db.from('user_roles').select('role').eq('user_id',owner).eq('role','athlete').maybeSingle();if(roles.error||!roles.data)return response({error:'forbidden'},403);
  const queued=await db.rpc('request_effort_records',{p_owner:owner,p_retry:body.retry===true});if(queued.error)throw Error();
  return response({accepted:true},202);
 }catch{return response({error:'temporarily_unavailable'},503);}
});
