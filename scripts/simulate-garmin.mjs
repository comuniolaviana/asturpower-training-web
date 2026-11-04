// Runs against an in-memory fake provider only. No real Garmin or Supabase requests.
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import {garminFixture,activityBody,IDs} from '../tests/garmin-fixture.mjs';
import {sendPlannedWorkout} from '../netlify/lib/garmin-training-service.mjs';
import {createGarminWebhookHandler,processGarminInbox} from '../netlify/lib/garmin-activity-service.mjs';

const fixture=garminFixture();
const send=()=>sendPlannedWorkout({repo:fixture.repo,env:fixture.env,actor:fixture.actor,
  workoutId:IDs.workout,fetcher:fixture.fetcher});
const published=await send(),repeated=await send();
assert.equal(published.status,'scheduled');assert.equal(repeated.already_sent,true);
const receive=createGarminWebhookHandler({env:fixture.env,repositoryFactory:()=>fixture.repo});
const body={activities:[...activityBody().activities,...activityBody('garmin-simulated-2').activities]};
const request=()=>new Request('https://simulated.example/garmin/activities',{
  method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
assert.equal((await receive(request(),{ip:'204.77.162.9'})).status,200);
assert.equal((await receive(request(),{ip:'204.77.162.9'})).status,200);
assert.equal(fixture.activities.size,0,'receipt does not process synchronously');
await processGarminInbox({env:fixture.env,repositoryFactory:()=>fixture.repo});
assert.equal(fixture.activities.size,2);assert.equal(fixture.inbox.size,1);
const report={mode:'SIMULATED_ONLY',checked_at:new Date().toISOString(),real_requests:0,
  training:{workouts_created:fixture.sent.workouts,calendar_entries_created:fixture.sent.schedules,
    repeat_deduplicated:repeated.already_sent,device_sync_confirmed:false},
  activity:{deliveries_received:2,inbox_records:fixture.inbox.size,activities_stored:fixture.activities.size,
    distinct_athletes:new Set([...fixture.activities.values()].map(a=>a.athlete_id)).size,
    plaintext_payload_retained:[...fixture.inbox.values()].some(r=>r.payload_ciphertext!==null)},
  limitations:['No athlete has authorized a real Garmin session in this test.',
    'Delivery endpoint activation and a compatible physical device are not tested.']};
if(process.argv.includes('--report'))await writeFile(new URL('../docs/garmin-pruebas-simuladas.json',import.meta.url),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));
