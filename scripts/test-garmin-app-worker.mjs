// Executes the optional app with real local workerd and the compiled Vite assets.
// All external network requests are denied. No deployed account is accessed.
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
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
  const script=html.match(/src="(\/assets\/[^" ]+\.js)"/)[1];
  const js=await runtime.dispatchFetch(origin+script);
  assert.equal(js.status,200);
  assert.match(js.headers.get('content-type'),/javascript/);
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
  console.log(JSON.stringify({runtime:'local workerd + real Vite assets',scenarios:13,
    external_requests:networkRequests,real_garmin_connection:false,production_deployment:false},null,2));
}finally{await runtime.dispose();}
