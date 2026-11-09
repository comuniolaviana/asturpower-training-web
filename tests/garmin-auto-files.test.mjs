import test from 'node:test';
import assert from 'node:assert/strict';
import {Encoder,Profile} from '@garmin/fitsdk';
import {minimizeGarminNotification,createGarminWebhookHandler,processGarminInbox} from '../netlify/lib/garmin-activity-service.mjs';
import {receiveGarminFile} from '../netlify/lib/garmin-file-receiver.mjs';
import {decodeApiFit,processApiFile} from '../supabase/functions/_shared/garmin-file-analysis.js';
import {garminFixture,IDs} from './garmin-fixture.mjs';
import {decryptedSecret} from '../netlify/lib/garmin-oauth-service.mjs';
import {sha256,originalIdentity} from '../app/src/garmin-original-vault.js';
const start=new Date('2026-11-07T15:00:00Z'),callback='https://apis.garmin.com/wellness-api/rest/activityFile?id=123&token=private-once';
const event={userId:'garmin-simulated-1',activityId:12345,fileType:'FIT',callbackURL:callback,startTimeInSeconds:start.getTime()/1000,activityName:'Prueba',activityType:'INDOOR_CYCLING',samples:[{latitude:123}]};
const notification=()=>({activityFiles:[event]});
function fit(){const e=new Encoder();e.onMesg(Profile.MesgNum.FILE_ID,{type:'activity',manufacturer:'development',product:1,timeCreated:start});
 e.onMesg(Profile.MesgNum.SESSION,{startTime:start,totalTimerTime:120,totalElapsedTime:120,sport:'cycling',normalizedPower:210,avgPower:200,intensityFactor:.84,trainingStressScore:3});
 e.onMesg(Profile.MesgNum.LAP,{startTime:start,totalTimerTime:120,avgHeartRate:130});
 for(let i=0;i<120;i++)e.onMesg(Profile.MesgNum.RECORD,{timestamp:new Date(+start+i*1000),heartRate:130+i%3,power:200,cadence:85,positionLat:123,positionLong:456});return e.close();}
test('file notification retains only a validated callback inside encrypted durable receipt and checks live identity',async()=>{
 const f=garminFixture();let imported=0;f.repo.importFile=async(e,c)=>{imported++;assert.equal(c.athlete_id,IDs.athlete);assert.equal(e.callbackURL,callback);};
 const h=createGarminWebhookHandler({env:f.env,repositoryFactory:()=>f.repo});
 assert.equal((await h(new Request('https://example.test',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(notification())}),{ip:'204.77.162.9'})).status,200);
 const row=[...f.inbox.values()][0];assert.doesNotMatch(row.payload_ciphertext,/private-once/);
 const clear=decryptedSecret(row.payload_ciphertext,f.env.GARMIN_TOKEN_ENCRYPTION_KEY,'inbox:'+row.id);assert.doesNotMatch(clear,/latitude|samples/);
 await processGarminInbox({env:f.env,repositoryFactory:()=>f.repo});assert.equal(imported,1);
 assert.throws(()=>minimizeGarminNotification({activityFiles:[{...event,callbackURL:'https://evil.test/?token=x'}]}));
 assert.throws(()=>minimizeGarminNotification({activityFiles:[{...event,fileType:'ZIP'}]}));
});
test('file download is reserved before the sole provider GET; uncertain outcomes and duplicate notifications never repeat it',async()=>{
 const order=[],f=garminFixture();let once=true;
 const db={rpc:async name=>{order.push(name);if(name==='start_garmin_api_file'){const download=once;once=false;return {data:{id:'job',download}};}return {data:null};},from:()=>({update:()=>({eq:()=>({eq:async()=>({error:null})})})})};
 const run=()=>receiveGarminFile({db,event:minimizeGarminNotification(notification())[0],connection:{athlete_id:IDs.athlete},receivedAt:new Date().toISOString(),fetcher:async()=>{order.push('GET');throw Error('must not leak token');}});
 assert.equal((await run()).status,'uncertain');await run();assert.deepEqual(order,['start_garmin_api_file','GET','start_garmin_api_file']);
});
test('official FIT parsing preserves every sport record and lap, excludes GPS from shared curves, validates the exact event date',()=>{
 const job={source_format:'FIT',external_id:String(event.activityId),summary:{activityId:String(event.activityId),activityType:event.activityType,startTimeInSeconds:+start/1000}},parsed=decodeApiFit(fit(),job);
 assert.equal(parsed.series.rows.length,120);assert.equal(parsed.series.laps.length,1);assert.equal(parsed.fit.device_tss,3);
 assert.ok(parsed.series.fields.includes('heartRate'));assert.ok(parsed.series.fields.includes('power'));assert.doesNotMatch(JSON.stringify(parsed.series),/positionLat|positionLong/);
 assert.throws(()=>decodeApiFit(fit(),{...job,summary:{startTimeInSeconds:0}}),/mismatch/);
});
test('automatic file processing joins by official activity ID, writes full curves and retained Garmin load without a browser',async()=>{
 const bytes=fit(),part={sha256:await sha256(bytes),size:bytes.length},archiveId=await originalIdentity([part],bytes.length),saved=[];
 const tables={garmin_connections:[{garmin_user_id:event.userId,permissions:['ACTIVITY_EXPORT'],connected_at:'2026-11-01T00:00:00Z'}],garmin_original_archives:[{archive_id:archiveId,byte_size:bytes.length,chunks:[part],status:'ready'}],activities:[{id:'activity',started_at:start.toISOString(),sport:'cycling'}],athlete_physiology:[],garmin_fit_analysis:[],garmin_activity_series:[],garmin_api_files:[]};
 const storage=new Map();
 const db={rpc:async()=>({data:null}),from:table=>{
  let payload=null,op=null;const q={select:()=>q,eq:()=>q,order:()=>q,limit:()=>q,single:()=>q,maybeSingle:()=>q,insert:v=>{payload=v;op='insert';return q;},upsert:v=>{payload=v;op='upsert';return q;},update:v=>{payload=v;op='update';return q;},then:resolve=>{
   if(payload){saved.push({table,op,payload});tables[table]=[payload];return resolve({data:null});}
   return resolve({data:['garmin_connections','garmin_original_archives','activities','garmin_fit_analysis','garmin_activity_series'].includes(table)?tables[table][0]||null:tables[table]});
  }};return q;},storage:{from:bucket=>({download:async path=>({data:bucket==='garmin-originals'?new Blob([bytes]):new Blob([storage.get(path)])}),upload:async(path,raw)=>{storage.set(path,raw);return {error:null};}})}};
 const job={id:'job',athlete_id:IDs.athlete,external_id:'12345',garmin_user_id:event.userId,received_at:new Date().toISOString(),archive_id:archiveId,source_format:'FIT',summary:{activityId:'12345',activityType:'INDOOR_CYCLING',startTimeInSeconds:+start/1000},lease_token:'lease'};
 const result=await processApiFile(db,job);assert.equal(result.records,120);assert.equal(result.laps,1);
 assert.equal(saved.find(s=>s.table==='garmin_fit_analysis').payload.device_tss,3);
 assert.equal(saved.find(s=>s.table==='garmin_fit_analysis').payload.measurement_source,'garmin_api_activity_id');
 assert.equal(saved.at(-1).payload.status,'ready');
 const compressed=[...storage.values()][0],json=JSON.parse(await new Response(new Blob([compressed]).stream().pipeThrough(new DecompressionStream('gzip'))).text());assert.equal(json.rows.length,120);
});
