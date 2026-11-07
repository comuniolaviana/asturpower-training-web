import test from 'node:test';
import assert from 'node:assert/strict';
import { createAppWorker } from '../cloudflare/garmin-app-worker.mjs';
import { garminFixture, activityBody } from './garmin-fixture.mjs';
import { minimizeGarminNotification } from '../netlify/lib/garmin-activity-service.mjs';
import { encryptedSecret } from '../netlify/lib/garmin-oauth-service.mjs';

const APP_ORIGIN='https://asturpower-garmin-dev.asturpower-training.workers.dev';
const request=(path,options)=>new Request(APP_ORIGIN+path,options);
const project={SUPABASE_URL:'https://drnefgxdrultneeodtsy.supabase.co'};
test('Cloudflare readiness checks format without exposing values or enabling OAuth',async()=>{
  const fixture=garminFixture();
  const env={...fixture.env,...project,GARMIN_REDIRECT_URI:APP_ORIGIN+'/.netlify/functions/garmin-callback',
    ASTURPOWER_APP_ENABLED:'false',ASTURPOWER_GARMIN_ENABLED:'false',ASTURPOWER_GARMIN_ACTIVITY_ENABLED:'false'};
  const worker=createAppWorker({verify:()=>{throw new Error('Must not access user data');},
    fetcher:()=>{throw new Error('Must not contact Garmin');}});
  const result=await worker.fetch(request('/health'),env);
  assert.deepEqual(await result.json(),{service:'asturpower-garmin-app',enabled:false,configuration_format_ready:true,configuration_invalid_fields:[],configuration_problem_types:{},diagnostic_version:2});
  for(const name of ['SUPABASE_URL','SUPABASE_PUBLISHABLE_KEY','SUPABASE_SECRET_KEY','GARMIN_CLIENT_ID','GARMIN_CLIENT_SECRET','GARMIN_TOKEN_ENCRYPTION_KEY','GARMIN_REDIRECT_URI']){
    const response=await worker.fetch(request('/health'),{...env,[name]:''});
    const body=await response.json();
    assert.equal(body.configuration_format_ready,false,name);
    assert.deepEqual(body.configuration_invalid_fields,[name]);
    assert.deepEqual(body.configuration_problem_types,{[name]:'missing'});
  }
  assert.equal((await worker.fetch(request('/health',{method:'POST'}),env)).status,405);
  assert.equal((await worker.fetch(request('/.netlify/functions/garmin-start',{method:'POST'}),env)).status,503);
  assert.equal((await worker.fetch(request('/.netlify/functions/public-config'),env)).status,503);
});
test('Cloudflare diagnostic categories distinguish masked and malformed input without returning it',async()=>{
  const env={...garminFixture().env,...project,GARMIN_REDIRECT_URI:APP_ORIGIN+'/.netlify/functions/garmin-callback',ASTURPOWER_APP_ENABLED:'false',ASTURPOWER_GARMIN_ENABLED:'false'};
  for(const name of ['SUPABASE_SECRET_KEY','GARMIN_CLIENT_ID','GARMIN_TOKEN_ENCRYPTION_KEY']){
    for(const value of ['********private-marker','\u2022\u2022\u2022\u2022private-marker','invalid:private-marker']){
      const response=await createAppWorker().fetch(request('/health'),{...env,[name]:value});
      const text=await response.text(),body=JSON.parse(text);
      assert.deepEqual(body.configuration_invalid_fields,[name]);
      assert.deepEqual(body.configuration_problem_types,{[name]:value.startsWith('invalid:')?'invalid_format':'masked_value'});
      assert.doesNotMatch(text,/private-marker/);
    }
  }
  const response=await createAppWorker().fetch(request('/health'),{...env,SUPABASE_SECRET_KEY:' '+env.SUPABASE_SECRET_KEY+'\n'});
  assert.deepEqual((await response.json()).configuration_problem_types,{SUPABASE_SECRET_KEY:'surrounding_whitespace'});
});
test('Cloudflare refuses a copied client-secret mask even when it meets the minimum length',async()=>{
  const env={...garminFixture().env,...project,GARMIN_REDIRECT_URI:APP_ORIGIN+'/.netlify/functions/garmin-callback'};
  for(const value of ['********private-marker','\u2022\u2022\u2022\u2022private-marker']){
    const response=await createAppWorker().fetch(request('/health'),{...env,GARMIN_CLIENT_SECRET:value});
    const text=await response.text(),body=JSON.parse(text);
    assert.deepEqual(body.configuration_invalid_fields,['GARMIN_CLIENT_SECRET']);
    assert.deepEqual(body.configuration_problem_types,{GARMIN_CLIENT_SECRET:'masked_value'});
    assert.doesNotMatch(text,/private-marker/);
  }
});
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

test('scheduled receiver stays inert when disabled or assigned another project',async()=>{
  let touched=false;const tasks=[];
  const worker=createAppWorker({repositoryFactory(){touched=true;throw new Error('must not access storage');}});
  await worker.scheduled({}, {...project,ASTURPOWER_GARMIN_ACTIVITY_ENABLED:'false'}, {waitUntil:task=>tasks.push(task)});
  await Promise.all(tasks);assert.equal(touched,false);assert.equal(tasks.length,1);
  await worker.scheduled({}, {SUPABASE_URL:'https://otherproject.supabase.co',ASTURPOWER_GARMIN_ACTIVITY_ENABLED:'true'}, {waitUntil(){throw new Error('must not schedule');}});
  assert.equal(touched,false);
});
test('scheduled receiver processes an encrypted fictitious delivery and clears its payload',async()=>{
  const fixture=garminFixture(),id='scheduled-fixture',tasks=[];
  const serialized=JSON.stringify(minimizeGarminNotification(activityBody()));
  fixture.inbox.set(id,{id,payload_ciphertext:encryptedSecret(serialized,fixture.env.GARMIN_TOKEN_ENCRYPTION_KEY,'inbox:'+id),
    received_at:'2026-11-05T12:00:00Z',status:'pending',attempts:0,cursor:0});
  let resumed=0;
  await createAppWorker({repositoryFactory:()=>fixture.repo,createClientFn:()=>({rpc:async name=>{assert.equal(name,'dispatch_pending_effort_jobs');resumed++;return {error:null};}})}).scheduled({},fixture.env,{waitUntil:task=>tasks.push(task)});
  await Promise.all(tasks);
  assert.equal(tasks.length,2);assert.equal(resumed,1);assert.equal(fixture.activities.size,1);
  assert.equal(fixture.inbox.get(id).status,'done');assert.equal(fixture.inbox.get(id).payload_ciphertext,null);
});
