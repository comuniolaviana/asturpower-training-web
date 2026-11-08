import test from 'node:test';
import assert from 'node:assert/strict';
import {GARMIN,GarminError,toGarminWorkout,isGarminIp,createGarminTransport,retrySeconds} from '../netlify/lib/garmin-protocol.mjs';
import {sendPlannedWorkout,createGarminWorkoutHandler} from '../netlify/lib/garmin-training-service.mjs';
import {createGarminWebhookHandler,processGarminInbox,minimizeGarminNotification,toActivityRecord} from '../netlify/lib/garmin-activity-service.mjs';
import {decryptedSecret} from '../netlify/lib/garmin-oauth-service.mjs';
import {publishWorkoutToGarmin} from '../app/src/garmin-api.js';
import {createWorker} from '../cloudflare/garmin-worker.mjs';
import {garminFixture,IDs,activityBody} from './garmin-fixture.mjs';

const send=f=>sendPlannedWorkout({repo:f.repo,env:f.env,actor:f.actor,workoutId:IDs.workout,fetcher:f.fetcher});
const incoming=body=>new Request('https://receiver.example/.netlify/functions/garmin-activities',{
  method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
const receiver=f=>createGarminWebhookHandler({env:f.env,repositoryFactory:()=>f.repo});
const process=f=>processGarminInbox({env:f.env,repositoryFactory:()=>f.repo});
const expectError=(promise,code)=>assert.rejects(promise,e=>e.code===code);

test('Training V2 conversion preserves seconds, percent FTP, provider and calendar date',()=>{
  const f=garminFixture(),payload=toGarminWorkout(f.workout);
  assert.equal(payload.sport,'CYCLING');assert.equal(payload.workoutSourceId,'AsturPower Training');
  assert.deepEqual(payload.segments[0].steps[1],{type:'WorkoutStep',stepOrder:2,intensity:'ACTIVE',
    durationType:'TIME',durationValue:1200,targetType:'POWER',targetValueLow:80,targetValueHigh:90,targetValueType:'PERCENT'});
  assert.equal(payload.segments[0].steps[0].intensity,'WARMUP');assert.equal(payload.segments[0].steps[2].intensity,'COOLDOWN');
  assert.equal(payload.ownerId,undefined);assert.equal(payload.workoutId,undefined);
});
test('watts and heart rate stay absolute; RPE remains an explicit instruction with open target',()=>{
  const f=garminFixture();f.workout.steps=[{phase:'work',duration_seconds:60,target_type:'watts',low:180,high:220},
    {phase:'recovery',duration_seconds:60,target_type:'hr_bpm',low:90,high:120},
    {phase:'cooldown',duration_seconds:60,target_type:'rpe',low:2,high:3}];
  const steps=toGarminWorkout(f.workout).segments[0].steps;
  assert.equal(steps[0].targetValueType,undefined);assert.equal(steps[0].targetType,'POWER');
  assert.equal(steps[1].targetType,'HEART_RATE');assert.equal(steps[2].targetType,'OPEN');assert.match(steps[2].description,/RPE.*2–3/);
});
for(const [label,patch,code] of [
  ['missing blocks',{steps:null},'structured_steps_required'],['swimming',{sport:'swimming'},'sport_not_supported'],
  ['bad date',{scheduled_date:'2026-02-30'},'invalid_date'],['bad target',{steps:[{phase:'work',duration_seconds:60,target_type:'ftp_pct',low:120,high:80}]},'invalid_steps'],
  ['running power',{sport:'running'},'target_not_supported'],
])test('rejects '+label+' before calling Garmin',async()=>{
  const f=garminFixture();Object.assign(f.workout,patch);await expectError(send(f),code);assert.equal(f.calls.length,0);
});
test('create plus schedule, persistent deduplication, and no claim that a device received it',async()=>{
  const f=garminFixture(),first=await send(f),second=await send(f);
  assert.deepEqual(f.sent,{workouts:1,schedules:1});assert.equal(first.status,'scheduled');
  assert.equal(first.device_sync_confirmed,false);assert.equal(second.already_sent,true);
  assert.equal(f.calls.find(c=>c.url===GARMIN.schedules).body.date,'2026-11-05');
  assert.ok(f.reserved.every(r=>r.id===IDs.athlete));
});
test('204 schedule receipt is checked against the Garmin calendar',async()=>{
  const f=garminFixture({schedule204:true});assert.equal((await send(f)).status,'scheduled');assert.equal(f.sent.schedules,1);
});
test('coach B, foreign athlete and admin role cannot access coach A workout',async()=>{
  for(const actor of [{id:IDs.otherCoach,roles:['coach']},{id:IDs.otherAthlete,roles:['athlete']},{id:IDs.otherCoach,roles:['admin']}]){
    const f=garminFixture();f.actor=actor;await expectError(send(f),'workout_not_available');assert.equal(f.calls.length,0);
  }
});
test('the athlete may send their own planned workout',async()=>{
  const f=garminFixture();f.actor={id:IDs.athlete,roles:['athlete']};assert.equal((await send(f)).status,'scheduled');
});
test('revoked coach link and cancelled workout prevent delivery',async()=>{
  const f=garminFixture();f.unlink();await expectError(send(f),'workout_not_available');assert.equal(f.calls.length,0);
  const g=garminFixture();g.workout.status='cancelled';await expectError(send(g),'workout_not_planned');assert.equal(g.calls.length,0);
});
test('permissions are checked on Garmin immediately before an export',async()=>{
  const f=garminFixture({permissions:['ACTIVITY_EXPORT']});await expectError(send(f),'workout_permission_required');
  assert.equal(f.sent.workouts,0);assert.deepEqual(f.connections.get(IDs.athlete).permissions,['ACTIVITY_EXPORT']);
});
test('a newly granted Training permission is checked live despite an older local cache',async()=>{
  const f=garminFixture({permissions:['WORKOUT_IMPORT']});
  f.connections.get(IDs.athlete).permissions=['ACTIVITY_EXPORT'];
  assert.equal((await send(f)).status,'scheduled');
  assert.deepEqual(f.connections.get(IDs.athlete).permissions,['WORKOUT_IMPORT']);
  assert.equal(f.calls[0].url,GARMIN.permissions);
});
test('an absent cached Training permission never grants access when Garmin denies it',async()=>{
  const f=garminFixture({permissions:['ACTIVITY_EXPORT']});
  f.connections.get(IDs.athlete).permissions=[];
  await expectError(send(f),'workout_permission_required');
  assert.equal(f.calls.length,1);assert.equal(f.calls[0].url,GARMIN.permissions);
  assert.deepEqual(f.sent,{workouts:0,schedules:0});assert.equal(f.jobs.size,0);
});
test('expired access token rotates refresh token and only ciphertext is stored',async()=>{
  const f=garminFixture(),row=f.connections.get(IDs.athlete);row.access_expires_at=new Date(0).toISOString();
  await send(f);const updated=f.connections.get(IDs.athlete);
  assert.equal(decryptedSecret(updated.refresh_token_ciphertext,f.env.GARMIN_TOKEN_ENCRYPTION_KEY,'refresh:'+IDs.athlete),'simulated-refresh-rotated');
  assert.doesNotMatch(JSON.stringify(updated),/simulated-access-rotated|simulated-refresh-rotated/);
  assert.equal(f.reserved.filter(r=>r.oauth).length,1);
});
test('expired refresh token requires athlete authorization without a provider call',async()=>{
  const f=garminFixture();Object.assign(f.connections.get(IDs.athlete),{access_expires_at:new Date(0).toISOString(),refresh_expires_at:new Date(0).toISOString()});
  await expectError(send(f),'garmin_reauthorization_required');assert.equal(f.calls.length,0);
});
test('parallel requests are serialized across the durable athlete lease',async()=>{
  const f=garminFixture(),results=await Promise.allSettled([send(f),send(f)]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.deepEqual(f.sent,{workouts:1,schedules:1});
  assert.equal(results.find(r=>r.status==='rejected').reason.code,'garmin_operation_in_progress');
});
test('changing a previously exported workout does not silently create a second version',async()=>{
  const f=garminFixture();await send(f);f.workout.title='Otra versión';await expectError(send(f),'exported_workout_changed');assert.equal(f.sent.workouts,1);
});
test('429 defers retry and preserves the remote workout when scheduling is rejected',async()=>{
  let rateLimited=true;
  const f=garminFixture({intercept:async url=>url===GARMIN.schedules&&rateLimited
    ?new Response(null,{status:429,headers:{'Retry-After':'90'}}):null});
  await expectError(send(f),'garmin_rate_limited');assert.equal(f.sent.workouts,1);
  await expectError(send(f),'garmin_rate_limited');rateLimited=false;f.jobs.get(IDs.workout).retry_at=new Date(0).toISOString();
  assert.equal((await send(f)).status,'scheduled');assert.equal(f.sent.workouts,1);
});
test('network timeout while creating a workout never triggers a blind duplicate POST',async()=>{
  const f=garminFixture({intercept:async url=>{if(url===GARMIN.createWorkout)throw new Error('socket private details');}});
  await expectError(send(f),'garmin_transport_failed');await expectError(send(f),'garmin_export_requires_review');
  assert.equal(f.calls.filter(c=>c.url===GARMIN.createWorkout).length,1);
});
test('ambiguous scheduling reconciles by reading the calendar, without a second POST',async()=>{
  const f=garminFixture({intercept:async(url,request,{remoteSchedules})=>{
    if(url===GARMIN.schedules){remoteSchedules.push({...JSON.parse(request.body),scheduleId:777});throw new Error('timeout');}
  }});
  await expectError(send(f),'garmin_transport_failed');assert.equal((await send(f)).status,'scheduled');
  assert.equal(f.calls.filter(c=>c.url===GARMIN.schedules).length,1);
});
test('an absent calendar entry after an ambiguous POST requires review on every retry',async()=>{
  const f=garminFixture({intercept:async url=>{if(url===GARMIN.schedules)throw new Error('timeout');}});
  await expectError(send(f),'garmin_transport_failed');
  for(let i=0;i<2;i++)await expectError(send(f),'garmin_export_requires_review');
  assert.equal(f.calls.filter(c=>c.url===GARMIN.schedules).length,1);
});
test('HTTP endpoint fails closed, rejects cross origin, forged athlete IDs and secret leakage',async()=>{
  const f=garminFixture(),make=env=>createGarminWorkoutHandler({env,verify:async()=>f.actor,repositoryFactory:()=>f.repo,fetcher:f.fetcher});
  const req=(body,headers={})=>new Request('https://app.example/.netlify/functions/garmin-workout',{method:'POST',
    headers:{Authorization:'Bearer simulated-session','Content-Type':'application/json',...headers},body:JSON.stringify(body)});
  assert.equal((await make({...f.env,ASTURPOWER_GARMIN_TRAINING_ENABLED:'false'})(req({workout_id:IDs.workout}))).status,503);
  assert.equal((await make(f.env)(req({workout_id:IDs.workout},{Origin:'https://attacker.example'}))).status,403);
  assert.equal((await make(f.env)(req({workout_id:IDs.workout,athlete_id:IDs.otherAthlete}))).status,400);
  const out=await make(f.env)(req({workout_id:IDs.workout}));assert.equal(out.status,200);
  assert.doesNotMatch(await out.text(),/simulated-access|simulated-secret|ciphertext/);
});
test('transport blocks arbitrary hosts and automatic redirects',async()=>{
  let redirected;
  const call=createGarminTransport({fetcher:async(url,opts)=>{redirected=opts.redirect;return Response.json({permissions:[]});}});
  await expectError(call('https://attacker.example',{token:'simulated'}),'endpoint_not_allowed');
  await call(GARMIN.permissions,{token:'simulated'});assert.equal(redirected,'manual');
  assert.equal(retrySeconds('120'),120);assert.equal(retrySeconds('invalid'),60);
});
test('redirected workout POST is never followed or automatically safe to resend',async()=>{
  let calls=0;
  const call=createGarminTransport({fetcher:async(url,opts)=>{
    calls++;assert.equal(url,GARMIN.createWorkout);assert.equal(opts.redirect,'manual');
    return new Response(null,{status:307,headers:{Location:'https://attacker.example/collect'}});
  }});
  await assert.rejects(call(GARMIN.createWorkout,{method:'POST',token:'simulated',body:{workoutName:'fixture'}}),
    error=>error.code==='garmin_redirect_rejected'&&error.uncertain===true);
  assert.equal(calls,1);
});
test('webhook accepts official IP ranges and rejects spoofed forwarded headers',async()=>{
  assert.equal(isGarminIp('204.77.163.99'),true);assert.equal(isGarminIp('::ffff:198.233.176.10'),true);
  for(const ip of ['204.77.164.1','127.0.0.1','unknown','204.77.162.999',''])assert.equal(isGarminIp(ip),false);
  const f=garminFixture(),request=incoming(activityBody());request.headers.set('X-Forwarded-For','204.77.163.99');
  assert.equal((await receiver(f)(request,{})).status,403);assert.equal(f.inbox.size,0);
});
test('durable receipt returns 200, encrypts only minimal fields and defers processing',async()=>{
  const f=garminFixture(),h=receiver(f);
  assert.equal((await h(incoming(activityBody()),{ip:'204.77.162.9'})).status,200);
  await h(incoming(activityBody()),{ip:'204.77.162.9'});
  assert.equal(f.inbox.size,1);assert.equal(f.activities.size,0);
  const entry=[...f.inbox.values()][0],data=decryptedSecret(entry.payload_ciphertext,f.env.GARMIN_TOKEN_ENCRYPTION_KEY,'inbox:'+entry.id);
  assert.doesNotMatch(data,/latitude|longitude|samples|userAccessToken|simulated-do-not-store/);
  assert.deepEqual(await process(f),{enabled:true,processed:1,failed:0});assert.equal(f.activities.size,1);
  assert.equal([...f.inbox.values()][0].payload_ciphertext,null);
});
test('two athletes, repeated summaries and details are imported without crossing identities',async()=>{
  const f=garminFixture();const one=activityBody(),two=activityBody('garmin-simulated-2','123456789');
  await receiver(f)(incoming({activities:[...one.activities,...two.activities]}),{ip:'204.77.162.9'});await process(f);
  const summary={...one.activities[0]};delete summary.userId;
  await receiver(f)(incoming({activityDetails:[{userId:'garmin-simulated-1',activityId:'123456789',summaryId:'123456789-detail',summary,samples:[{powerInWatts:500}]}]}),{ip:'204.77.162.9'});
  await process(f);assert.equal(f.activities.size,2);
  assert.equal(f.activities.get(IDs.athlete+':123456789').athlete_id,IDs.athlete);
  assert.equal(f.activities.get(IDs.otherAthlete+':123456789').athlete_id,IDs.otherAthlete);
  assert.equal(f.activities.get(IDs.athlete+':123456789').avg_power_watts,null);
});
test('unknown Garmin user, missing permission and a newer association do not import data',async()=>{
  for(const scenario of ['unknown','permission','newer']){
    const f=garminFixture();if(scenario==='permission')f.connections.get(IDs.athlete).permissions=['WORKOUT_IMPORT'];
    if(scenario==='newer')f.connections.get(IDs.athlete).connected_at='2099-01-01T00:00:00Z';
    await receiver(f)(incoming(activityBody(scenario==='unknown'?'unknown-garmin-user':'garmin-simulated-1')),{ip:'204.77.162.9'});
    await process(f);assert.equal(f.activities.size,0);
  }
});
test('permission withdrawal and deregistration precede activities in the same delivery',async()=>{
  for(const control of [{userPermissionsChange:[{userId:'garmin-simulated-1',permissions:[],changeTimeInSeconds:1793790000}]},
    {deregistrations:[{userId:'garmin-simulated-1'}]}]){
    const f=garminFixture();await receiver(f)(incoming({...activityBody(),...control}),{ip:'204.77.162.9'});await process(f);
    assert.equal(f.activities.size,0);
  }
});
test('old permission notification cannot re-enable a withdrawn permission',async()=>{
  const f=garminFixture();Object.assign(f.connections.get(IDs.athlete),{permissions:[],permissions_changed_at:500});
  await receiver(f)(incoming({userPermissionsChange:[{userId:'garmin-simulated-1',permissions:['ACTIVITY_EXPORT'],changeTimeInSeconds:400}]}),{ip:'204.77.162.9'});
  await process(f);assert.deepEqual(f.connections.get(IDs.athlete).permissions,[]);
});
test('zero distance is preserved and missing metrics do not become invented values',()=>{
  const record=toActivityRecord(minimizeGarminNotification(activityBody())[0],IDs.athlete);
  assert.equal(record.distance_meters,0);assert.equal(record.elevation_gain_meters,null);
  assert.equal(record.started_at,new Date(1793692800*1000).toISOString());
});
test('oversized and unsupported webhook bodies are rejected without storing data',async()=>{
  const f=garminFixture();assert.equal((await receiver(f)(incoming({moveIQActivities:[{callbackURL:'http://127.0.0.1'}]}),{ip:'204.77.162.9'})).status,422);
  assert.equal((await receiver(f)(incoming({activities:[{userId:'bad'}]}),{ip:'204.77.162.9'})).status,400);
  assert.equal((await receiver(f)(incoming({activities:[],extra:'x'.repeat(1048576)}),{ip:'204.77.162.9'})).status,413);
  assert.equal(f.inbox.size,0);
});
test('queue persistence failure is not acknowledged with HTTP 200',async()=>{
  const f=garminFixture();f.repo.enqueue=async()=>{throw new Error('private database details');};
  const response=await receiver(f)(incoming(activityBody()),{ip:'204.77.162.9'});assert.equal(response.status,503);
  assert.doesNotMatch(await response.text(),/private database/);
});
test('malformed activity is retained for bounded retry, without plaintext errors',async()=>{
  const f=garminFixture(),body=activityBody();body.activities[0].durationInSeconds=-1;
  await receiver(f)(incoming(body),{ip:'204.77.162.9'});
  for(let i=0;i<5;i++)assert.equal((await process(f)).failed,1);
  assert.equal([...f.inbox.values()][0].status,'failed');assert.equal(f.activities.size,0);
});
test('large notifications checkpoint progress and resume without exhausting retry attempts',async()=>{
  const f=garminFixture(),body={activities:Array.from({length:60},(_,i)=>activityBody('garmin-simulated-1',String(1000+i)).activities[0])};
  await receiver(f)(incoming(body),{ip:'204.77.162.9'});
  assert.equal((await process(f)).processed,0);assert.equal(f.activities.size,25);
  assert.equal([...f.inbox.values()][0].cursor,25);assert.equal([...f.inbox.values()][0].attempts,0);
  assert.equal((await process(f)).processed,0);assert.equal(f.activities.size,50);
  assert.equal((await process(f)).processed,1);assert.equal(f.activities.size,60);
});
test('Cloudflare alternative is disabled by default and does not move OAuth',async()=>{
  const worker=createWorker();
  assert.equal((await worker.fetch(new Request('https://worker.example/health'),{})).status,200);
  assert.equal((await worker.fetch(incoming(activityBody()),{})).status,404);
  assert.equal((await worker.fetch(new Request('https://worker.example/garmin/activities',{method:'POST'}),{})).status,503);
  assert.equal((await worker.fetch(new Request('https://worker.example/.netlify/functions/garmin-callback'),{})).status,404);
});
test('Cloudflare adapter and the shared receiver enqueue the same verified event',async()=>{
  const f=garminFixture(),worker=createWorker({repositoryFactory:()=>f.repo});
  const req=new Request('https://worker.example/garmin/activities',{method:'POST',
    headers:{'Content-Type':'application/json','CF-Connecting-IP':'204.77.162.9'},body:JSON.stringify(activityBody())});
  assert.equal((await worker.fetch(req,f.env)).status,200);assert.equal(f.inbox.size,1);
});
test('browser sends only workout ID and AsturPower session; successful message is calendar-only',async()=>{
  let sent;
  const result=await publishWorkoutToGarmin({auth:{getSession:async()=>({data:{session:{access_token:'simulated-session'}}})}},IDs.workout,
    async(url,request)=>{sent=JSON.parse(request.body);return Response.json({status:'scheduled',device_sync_confirmed:false});});
  assert.deepEqual(sent,{workout_id:IDs.workout});assert.match(result,/Sincroniza tu dispositivo/);
});
