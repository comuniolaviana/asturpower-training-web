// Runs the bundled receiver in local workerd. Every outbound request is intercepted.
// No account, deployment, hosted database, real credentials or health data are used.
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { Miniflare, convertV4MiniflareOptions, Response as LocalResponse } from 'miniflare';
import { decryptedSecret } from '../netlify/lib/garmin-oauth-service.mjs';

const key=randomBytes(32).toString('base64url');
const env={ASTURPOWER_APP_ENABLED:'true',ASTURPOWER_GARMIN_ACTIVITY_ENABLED:'true',
  SUPABASE_URL:'https://asturpowerfixture.supabase.co',SUPABASE_PUBLISHABLE_KEY:'sb_publishable_fictitious',
  SUPABASE_SECRET_KEY:'sb_secret_fictitious',GARMIN_TOKEN_ENCRYPTION_KEY:key};
const inbox=new Map();let intercepted=0,failStorage=false;
const options=bindings=>({...convertV4MiniflareOptions({modules:true,
  scriptPath:fileURLToPath(new URL('../.wrangler/garmin-build/garmin-worker.js',import.meta.url)),
  compatibilityDate:'2026-11-04',compatibilityFlags:['nodejs_compat'],cf:false,bindings,
  outboundService:async request=>{
    intercepted++;
    const url=new URL(request.url);
    assert.equal(url.origin,env.SUPABASE_URL,'unexpected network destination');
    assert.equal(url.pathname,'/rest/v1/garmin_webhook_inbox');
    assert.equal(request.method,'POST');
    assert.match(request.headers.get('prefer'),/resolution=ignore-duplicates/);
    if(failStorage)return new LocalResponse(JSON.stringify({message:'private database error'}),{status:500});
    const row=await request.json();
    assert.equal(typeof row.payload_ciphertext,'string');
    assert.doesNotMatch(row.payload_ciphertext,/fictitious-user|Actividad ficticia|callbackURL/);
    const events=JSON.parse(decryptedSecret(row.payload_ciphertext,key,'inbox:'+row.id));
    assert.equal(events[0].userId,'fictitious-user');
    assert.equal(events[0].summary.activityId,'123456');
    assert.equal(events[0].summary.callbackURL,undefined);
    if(!inbox.has(row.id))inbox.set(row.id,row);
    return new LocalResponse(null,{status:201});
  },
}),telemetry:{enabled:false}});
const runtime=new Miniflare(options({ASTURPOWER_GARMIN_ACTIVITY_ENABLED:'false'}));
const base='https://receiver.example';
const notification={activities:[{userId:'fictitious-user',activityId:'123456',activityType:'CYCLING',
  activityName:'Actividad ficticia',startTimeInSeconds:1793692800,durationInSeconds:600,
  callbackURL:'https://must-never-be-fetched.invalid',samples:[{latitudeInDegree:1}]}]};
const post=ip=>({method:'POST',headers:{'Content-Type':'application/json',
  ...(ip?{'CF-Connecting-IP':ip}:{}),'X-Forwarded-For':'204.77.162.9'},body:JSON.stringify(notification)});
try{
  const health=await runtime.dispatchFetch(base+'/health');
  assert.equal(health.status,200);assert.equal((await health.json()).enabled,false);
  assert.equal((await runtime.dispatchFetch(base+'/garmin/activities',post('204.77.162.9'))).status,503);
  assert.equal((await runtime.dispatchFetch(base+'/.netlify/functions/garmin-callback')).status,404);
  assert.equal(intercepted,0);
  await runtime.setOptions(options(env));
  assert.equal((await runtime.dispatchFetch(base+'/garmin/activities',post())).status,403,'XFF cannot authorize a sender');
  assert.equal(intercepted,0);
  assert.equal((await runtime.dispatchFetch(base+'/garmin/activities',post('204.77.162.9'))).status,200);
  assert.equal((await runtime.dispatchFetch(base+'/garmin/activities',post('204.77.162.9'))).status,200);
  assert.equal(inbox.size,1);
  failStorage=true;
  const failed=await runtime.dispatchFetch(base+'/garmin/activities',post('204.77.162.9'));
  assert.equal(failed.status,503);assert.doesNotMatch(await failed.text(),/private database/);
  console.log(JSON.stringify({runtime:'local workerd/Miniflare',scenarios:7,
    intercepted_storage_requests:intercepted,real_external_requests:0,unique_deliveries:inbox.size,
    production_deployment:false},null,2));
}finally{await runtime.dispose();}
