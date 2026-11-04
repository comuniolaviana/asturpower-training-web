import test from 'node:test';
import assert from 'node:assert/strict';
import { createAppWorker } from '../cloudflare/garmin-app-worker.mjs';
import { garminFixture } from './garmin-fixture.mjs';

const APP_ORIGIN='https://asturpower-garmin-dev.asturpower-training.workers.dev';
const request=(path,options)=>new Request(APP_ORIGIN+path,options);
const project={SUPABASE_URL:'https://drnefgxdrultneeodtsy.supabase.co'};
test('Cloudflare app refuses another project and unknown server routes without network',async()=>{
  const worker=createAppWorker();
  for(const env of [{},{SUPABASE_URL:'https://otherproject.supabase.co'}]){
    const result=await worker.fetch(request('/.netlify/functions/public-config'),env);
    assert.equal(result.status,503);
  }
  for(const path of ['garmin-process','constructor','toString','unknown']){
    assert.equal((await worker.fetch(request('/.netlify/functions/'+path),project)).status,404);
  }
  assert.equal((await worker.fetch(new Request('https://host-spoof.invalid/health'),{})).status,421);
});
test('Cloudflare public configuration returns only publishable values',async()=>{
  const env={...project,ASTURPOWER_APP_ENABLED:'true',SUPABASE_PUBLISHABLE_KEY:'sb_publishable_fictitious',
    SUPABASE_SECRET_KEY:'sb_secret_never_publish',GARMIN_CLIENT_SECRET:'never_publish'};
  const response=await createAppWorker().fetch(request('/.netlify/functions/public-config'),env);
  assert.equal(response.status,200);
  assert.deepEqual(await response.json(),{supabaseUrl:project.SUPABASE_URL,publishableKey:env.SUPABASE_PUBLISHABLE_KEY});
  assert.equal(response.headers.get('cache-control'),'no-store, max-age=0');
});
test('Cloudflare callback removes OAuth parameters and stays at the fixed staging origin',async()=>{
  const response=await createAppWorker().fetch(request('/.netlify/functions/garmin-callback?code=private-code&state=private-state'),project);
  assert.equal(response.status,303);
  const landing=new URL(response.headers.get('location'));
  assert.equal(landing.origin,APP_ORIGIN);
  assert.equal(landing.search,'?garmin=not_ready');
  assert.doesNotMatch(response.headers.get('location'),/private-/);
});
test('Cloudflare uses the existing coach and workout authentication checks',async()=>{
  const fixture=garminFixture();
  const worker=createAppWorker();
  for(const path of ['team','garmin-workout']){
    const response=await worker.fetch(request('/.netlify/functions/'+path,{method:'POST',headers:{Origin:'https://foreign.invalid'}}),
      {...fixture.env,ASTURPOWER_TEAM_ENABLED:'true'});
    assert.equal(response.status,403);
  }
  assert.equal((await worker.fetch(request('/.netlify/functions/garmin-workout',{method:'POST'}),fixture.env)).status,401);
});
test('Cloudflare OAuth refuses the old provider callback until explicitly configured',async()=>{
  const fixture=garminFixture();
  let contacted=false;
  const worker=createAppWorker({verify:async()=>{contacted=true;throw new Error('must not authenticate');}});
  const response=await worker.fetch(request('/.netlify/functions/garmin-start',{method:'POST'}),fixture.env);
  assert.equal(response.status,503);
  assert.equal(contacted,false);
});
test('Cloudflare assets get staging security headers and API errors never become HTML',async()=>{
  const seen=[];
  const env={...project,ASSETS:{async fetch(req){seen.push(new URL(req.url).pathname);
    return new URL(req.url).pathname==='/index.html'?new Response('<html>fixture</html>',{headers:{'content-type':'text/html'}}):new Response('missing',{status:404});}}};
  const worker=createAppWorker();
  const page=await worker.fetch(request('/calendar'),env);
  assert.equal(page.status,200);
  assert.deepEqual(seen,['/calendar','/index.html']);
  assert.equal(page.headers.get('x-frame-options'),'DENY');
  assert.match(page.headers.get('content-security-policy'),/connect-src 'self' https:\/\/drnefgxdrultneeodtsy\.supabase\.co;/);
  assert.equal((await worker.fetch(request('/assets/missing.js'),env)).status,404);
  assert.equal((await worker.fetch(request('/.netlify/functions/missing'),env)).status,404);
  assert.equal((await worker.fetch(request('/calendar',{method:'POST'}),env)).status,405);
});
