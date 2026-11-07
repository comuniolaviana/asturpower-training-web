import {createClient} from 'npm:@supabase/supabase-js@2.118.0';
import webpush from 'npm:web-push@3.6.7';
const ORIGIN='https://asturpower-garmin-dev.asturpower-training.workers.dev';
const cors={'Access-Control-Allow-Origin':ORIGIN,'Access-Control-Allow-Headers':'authorization, apikey, content-type, x-client-info','Access-Control-Allow-Methods':'GET, POST, OPTIONS','Cache-Control':'no-store'};
const response=(body:unknown,status=200)=>Response.json(body,{status,headers:cors});
const uuid=(v:unknown)=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
// Fixed work budget. Never log endpoints, credentials, notification contents or provider errors.
const secureEqual=(a:string,b:string)=>{let diff=a.length^b.length;for(let i=0;i<b.length;i++)diff|=(a.charCodeAt(i)||0)^b.charCodeAt(i);return diff===0;};
Deno.serve(async(req:Request)=>{
 if(req.headers.get('origin')&&req.headers.get('origin')!==ORIGIN)return response({error:'invalid_origin'},403);
 if(req.method==='OPTIONS')return new Response(null,{status:204,headers:cors});
 if(!['GET','POST'].includes(req.method))return response({error:'method_not_allowed'},405);
 try{
  const url=Deno.env.get('SUPABASE_URL')!;
  const key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if(!key)return response({error:'unavailable'},503);
  const db=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
  let {data:config,error:configError}=await db.rpc('server_push_config');
  if(configError||!config)return response({error:'unavailable'},503);
  if(!config.public_key){const keys=webpush.generateVAPIDKeys();const saved=await db.rpc('server_push_keys',{pub:keys.publicKey,priv:keys.privateKey});if(saved.error)throw Error();config=saved.data;}
  if(req.method==='GET')return response({publicKey:config.public_key});
  const body=await req.json();
  // Database webhook uses a private random secret. User requests verify JWT with Auth.
  const hook=req.headers.get('x-asturpower-hook');
  if(!hook||hook.length!==config.hook_secret.length||!secureEqual(hook,config.hook_secret)){
   const token=req.headers.get('authorization')?.replace(/^Bearer /i,'');
   if(!token)return response({error:'unauthorized'},401);
   const {data:auth,error}=await db.auth.getUser(token);
   if(error||!auth.user||body.action!=='test')return response({error:'unauthorized'},401);
   const uid=auth.user.id;
   const {data:recent,error:recentError}=await db.from('app_notifications').select('id').eq('recipient_id',uid).eq('kind','test').gte('occurred_at',new Date(Date.now()-300000).toISOString()).limit(1);
   if(recentError)throw Error();
   if(recent?.length)return response({error:'wait_five_minutes'},429);
   const {error:insertError}=await db.from('app_notifications').insert({recipient_id:uid,athlete_id:uid,kind:'test',entity_id:crypto.randomUUID(),event_date:new Date().toISOString().slice(0,10),title:'Avisos activados',message:'Este móvil ya puede recibir tus novedades.'});
   if(insertError)throw Error();
   return response({ok:true});
  }
  if(!uuid(body.notification_id))return response({error:'invalid_request'},400);
  const {data:n,error:nError}=await db.from('app_notifications').select('id,recipient_id,athlete_id,occurred_at').eq('id',body.notification_id).maybeSingle();
  if(nError)throw Error();
  if(!n||Date.now()-new Date(n.occurred_at).getTime()>86400000)return response({ok:true});
  if(n.recipient_id!==n.athlete_id){const {data:link,error}=await db.from('coach_athletes').select('athlete_id').eq('coach_id',n.recipient_id).eq('athlete_id',n.athlete_id).eq('status','active').maybeSingle();if(error)throw Error();if(!link)return response({ok:true});}
  const {data:subs,error:sError}=await db.from('app_push_subscriptions').select('id,endpoint,p256dh,auth').eq('owner_id',n.recipient_id).eq('enabled',true).limit(20);
  if(sError)throw Error();
  await Promise.all((subs||[]).map(async(s)=>{
   const endpoint=new URL(s.endpoint);
   if(endpoint.protocol!=='https:'||endpoint.port||endpoint.username||endpoint.password||!(/^(fcm\.googleapis\.com|updates\.push\.services\.mozilla\.com|web\.push\.apple\.com|[a-z0-9.-]+\.notify\.windows\.com)$/.test(endpoint.hostname)))return;
   const {data:claimed,error}=await db.rpc('server_claim_push',{n:n.id,s:s.id,r:n.occurred_at});if(error||!claimed)return;
   try{await webpush.sendNotification({endpoint:s.endpoint,keys:{p256dh:s.p256dh,auth:s.auth}},JSON.stringify({recipient:n.recipient_id,id:n.id}),{vapidDetails:{subject:'mailto:AsturPower.Training@gmail.com',publicKey:config.public_key,privateKey:config.private_key},TTL:86400,timeout:5000});}
   catch(e){if([404,410].includes(e.statusCode))await db.from('app_push_subscriptions').update({enabled:false}).eq('id',s.id);}
  }));
  return response({ok:true});
 }catch{return response({error:'temporarily_unavailable'},503);}
});
