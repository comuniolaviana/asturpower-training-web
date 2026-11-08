// Executes the optional app with real local workerd and the compiled Vite assets.
// All external network requests are denied. No deployed account is accessed.
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { readFile, readdir } from 'node:fs/promises';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
const origin='https://asturpower-garmin-dev.asturpower-training.workers.dev';
let networkRequests=0;
const runtime=new Miniflare({...convertV4MiniflareOptions({modules:true,
  scriptPath:fileURLToPath(new URL('../.wrangler/garmin-app-build/garmin-app-worker.js',import.meta.url)),
  compatibilityDate:'2026-11-04',compatibilityFlags:['nodejs_compat'],cf:false,
  bindings:{SUPABASE_URL:'https://drnefgxdrultneeodtsy.supabase.co',ASTURPOWER_GARMIN_ACTIVITY_ENABLED:'false'},
  assets:{directory:fileURLToPath(new URL('../.wrangler/garmin-app-assets/',import.meta.url)),binding:'ASSETS',run_worker_first:true,
    routerConfig:{has_user_worker:true},
    assetConfig:{html_handling:'none',not_found_handling:'none'}},
  outboundService:async()=>{networkRequests++;throw new Error('External network forbidden');},
}),telemetry:{enabled:false}});
try{
  const page=await runtime.dispatchFetch(origin+'/');
  assert.equal(page.status,200,await page.clone().text());
  assert.equal(page.headers.get('x-frame-options'),'DENY');
  assert.equal(page.headers.get('cache-control'),'no-store, max-age=0');
  const html=await page.text();
  assert.match(html,/AsturPower Training/);
  assert.match(html,/rel="manifest" href="\/manifest.webmanifest"/);
  const manifestResponse=await runtime.dispatchFetch(origin+'/manifest.webmanifest');
  assert.equal(manifestResponse.status,200);
  const manifest=await manifestResponse.json();assert.equal(manifest.display,'standalone');assert.equal(manifest.scope,'/');
  for(const icon of manifest.icons){
    const response=await runtime.dispatchFetch(origin+icon.src);assert.equal(response.status,200);
    assert.match(response.headers.get('content-type'),/image\/png/);
    const bytes=new DataView(await response.arrayBuffer());
    assert.equal(bytes.getUint32(16),Number(icon.sizes.split('x')[0]));
  }
  const serviceWorker=await runtime.dispatchFetch(origin+'/sw.js');assert.equal(serviceWorker.status,200);
  assert.match(serviceWorker.headers.get('content-type'),/javascript/);
  assert.match(await serviceWorker.text(),/const FILES=\[/);
  const offline=await runtime.dispatchFetch(origin+'/offline.html');assert.equal(offline.status,200);assert.match(await offline.text(),/No hemos podido abrir AsturPower/);
  const recovery=await runtime.dispatchFetch(origin+'/offline-recovery.js');assert.equal(recovery.status,200);assert.match(recovery.headers.get('content-type'),/javascript/);
  const script=html.match(/src="(\/assets\/[^" ]+\.js)"/)[1];
  const js=await runtime.dispatchFetch(origin+script);
  assert.equal(js.status,200);
  assert.match(js.headers.get('content-type'),/javascript/);
  const workerAsset=(await readdir(new URL('../.wrangler/garmin-app-assets/assets/',import.meta.url)))
    .find(name=>/^garmin-full-fit-worker-.*\.js$/.test(name));
  assert.ok(workerAsset,'full FIT reader must be bundled as a same-origin Worker');
  const fitWorker=await runtime.dispatchFetch(origin+'/assets/'+workerAsset);
  assert.equal(fitWorker.status,200);
  assert.match(fitWorker.headers.get('content-type'),/javascript/);
  assert.match(fitWorker.headers.get('content-security-policy'),/script-src 'self'/);
  const privacy=await runtime.dispatchFetch(origin+'/privacidad-garmin.html');
  assert.equal(privacy.status,200);
  assert.match(privacy.headers.get('content-type'),/text\/html/);
  const privacyText=await privacy.text();
  assert.match(privacyText,/Cloudflare Workers/);
  assert.match(privacyText,/garmin-2026-11-05/);
  assert.doesNotMatch(privacyText,/<script|style=/);
  const css=await runtime.dispatchFetch(origin+'/garmin-privacy.css');
  assert.equal(css.status,200);
  assert.match(css.headers.get('content-type'),/text\/css/);
  const deepLink=await runtime.dispatchFetch(origin+'/calendar');
  assert.equal(deepLink.status,200);
  assert.equal(await deepLink.text(),html);
  assert.equal((await runtime.dispatchFetch(origin+'/assets/missing.js')).status,404);
  assert.equal((await runtime.dispatchFetch(origin+'/.netlify/functions/public-config')).status,503);
  assert.equal((await runtime.dispatchFetch(origin+'/.netlify/functions/garmin-workout',{method:'POST'})).status,503);
  assert.equal((await runtime.dispatchFetch(origin+'/.netlify/functions/garmin-process')).status,404);
  const callback=await runtime.dispatchFetch(origin+'/.netlify/functions/garmin-callback?code=not-a-real-code', {redirect:'manual'});
  assert.equal(callback.status,303);
  assert.equal(callback.headers.get('location'),origin+'/?garmin=not_ready');
  assert.equal((await runtime.dispatchFetch(origin+'/garmin/activities',{method:'POST',body:'{}'})).status,503);
  assert.equal((await runtime.dispatchFetch('https://foreign.invalid/health')).status,421);
  const health=await runtime.dispatchFetch(origin+'/health');
  assert.deepEqual(await health.json(),{service:'asturpower-garmin-app',enabled:false,configuration_format_ready:false,
    configuration_invalid_fields:['SUPABASE_PUBLISHABLE_KEY','SUPABASE_SECRET_KEY','GARMIN_CLIENT_ID','GARMIN_CLIENT_SECRET','GARMIN_TOKEN_ENCRYPTION_KEY','GARMIN_REDIRECT_URI'],
    configuration_problem_types:{SUPABASE_PUBLISHABLE_KEY:'missing',SUPABASE_SECRET_KEY:'missing',GARMIN_CLIENT_ID:'missing',GARMIN_CLIENT_SECRET:'missing',GARMIN_TOKEN_ENCRYPTION_KEY:'missing',GARMIN_REDIRECT_URI:'missing'},diagnostic_version:2});
  assert.equal(networkRequests,0);
  console.log(JSON.stringify({runtime:'local workerd + real Vite assets',scenarios:19,
    external_requests:networkRequests,real_garmin_connection:false,production_deployment:false},null,2));
}finally{await runtime.dispose();}

// Exercise the bundled OAuth handlers with workerd's native fetch, not an
// injected fetcher. Only the provider responses and database are fictitious.
// This catches unsupported RequestInit modes before a real account is needed.
const fixtureEntry=`
import {createAppWorker} from './garmin-app-worker.js';
let pending=null,connection=null;
const client=()=>({from(table){
  if(table==='garmin_oauth_states')return {
    async insert(row){pending=row;return {error:null};},
    update(){return {eq(){return this;},is(){return this;},gt(){return this;},select(){return this;},
      async maybeSingle(){const row=pending;pending=null;return {data:row,error:null};}};}
  };
  if(table==='garmin_connections')return {
    async upsert(row){connection=row;return {error:null};},
    select(){return {eq(){return this;},async maybeSingle(){return {data:connection,error:null};}};}
  };
  throw new Error('Unexpected fixture table');
}});
export default createAppWorker({createClientFn:client,verify:async()=>({id:'a0000000-0000-4000-8000-000000000001',roles:['athlete']})});
`;
const root=fileURLToPath(new URL('../.wrangler/garmin-app-build/',import.meta.url));
let providerStatus=200,providerRequests=[];
const oauthRuntime=new Miniflare({...convertV4MiniflareOptions({
  modules:[{type:'ESModule',path:root+'oauth-fixture.mjs',contents:fixtureEntry},
    {type:'ESModule',path:root+'garmin-app-worker.js',contents:await readFile(root+'garmin-app-worker.js','utf8')}],
  compatibilityDate:'2026-11-04',compatibilityFlags:['nodejs_compat'],cf:false,
  bindings:{SUPABASE_URL:'https://drnefgxdrultneeodtsy.supabase.co',
    SUPABASE_PUBLISHABLE_KEY:'sb_publishable_fixture',SUPABASE_SECRET_KEY:'sb_secret_fixture',
    GARMIN_CLIENT_ID:'fixture-client-id',GARMIN_CLIENT_SECRET:'fixture-client-secret',
    GARMIN_TOKEN_ENCRYPTION_KEY:Buffer.alloc(32,7).toString('base64url'),
    GARMIN_REDIRECT_URI:origin+'/.netlify/functions/garmin-callback',
    ASTURPOWER_APP_ENABLED:'true',ASTURPOWER_GARMIN_ENABLED:'true',
    ASTURPOWER_GARMIN_TRAINING_ENABLED:'false',ASTURPOWER_GARMIN_ACTIVITY_ENABLED:'false'},
  outboundService:async request=>{
    const url=new URL(request.url);providerRequests.push(url.origin+url.pathname);
    if(url.origin==='https://diauth.garmin.com'&&url.pathname==='/di-oauth2-service/oauth/token'){
      assert.equal(request.method,'POST');
      assert.equal(request.headers.get('authorization'),'Basic '+Buffer.from('fixture-client-id:fixture-client-secret').toString('base64'));
      if(providerStatus!==200)return new Response(null,{status:providerStatus,headers:{Location:'https://must-not-be-followed.invalid/'}});
      return Response.json({access_token:'fictional-access',refresh_token:'fictional-refresh',expires_in:86400,refresh_token_expires_in:7775998});
    }
    assert.equal(url.origin,'https://apis.garmin.com');
    if(url.pathname==='/partner-gateway/rest/user/id')return Response.json({userId:'fictional-garmin-user'});
    if(url.pathname==='/partner-gateway/rest/user/permissions')return Response.json({permissions:['WORKOUT_IMPORT']});
    throw new Error('Unexpected outbound fixture request');
  },
}),telemetry:{enabled:false}});
try{
  const start=async()=>{
    const response=await oauthRuntime.dispatchFetch(origin+'/.netlify/functions/garmin-start',{
      method:'POST',headers:{Authorization:'Bearer fictional-session','Content-Type':'application/json'},body:JSON.stringify({consent:true})});
    assert.equal(response.status,200);
    const authorization=new URL((await response.json()).authorization_url);
    const callback=new URL(origin+'/.netlify/functions/garmin-callback');
    callback.searchParams.set('state',authorization.searchParams.get('state'));
    callback.searchParams.set('code','fictional-code');
    return oauthRuntime.dispatchFetch(callback.toString(),{redirect:'manual'});
  };
  const connected=await start();
  assert.equal(connected.headers.get('location'),origin+'/?garmin=connected');
  assert.equal(providerRequests.length,3);
  const status=await oauthRuntime.dispatchFetch(origin+'/.netlify/functions/garmin-status',{headers:{Authorization:'Bearer fictional-session'}});
  const state=await status.json();assert.equal(state.connected,true);assert.deepEqual(state.permissions,['WORKOUT_IMPORT']);
  for(const redirect of [301,302,303,307,308]){
    providerStatus=redirect;const previous=providerRequests.length;
    const rejected=await start();
    assert.equal(rejected.headers.get('location'),origin+'/?garmin=failed&issue=token_redirect');
    assert.equal(providerRequests.length,previous+1);
  }
  assert.ok(providerRequests.every(url=>!url.includes('must-not-be-followed')));
  console.log(JSON.stringify({runtime:'local workerd native OAuth fetch',scenarios:6,
    simulated_provider_requests:providerRequests.length,real_garmin_connection:false,external_network:false}));
}finally{await oauthRuntime.dispose();}
