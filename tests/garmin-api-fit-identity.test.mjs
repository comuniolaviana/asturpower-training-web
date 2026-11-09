import test from 'node:test';
import assert from 'node:assert/strict';
import {Encoder,Profile} from '@garmin/fitsdk';
import {decodeApiFit,assertGarminApiFileIdentity} from '../supabase/functions/_shared/garmin-file-analysis.js';

// Synthetic FIT only: this test never accesses Garmin, credentials or athlete data.
const START=new Date('2026-11-07T19:16:08Z');
function makeFit(){
 const encoder=new Encoder();
 encoder.onMesg(Profile.MesgNum.FILE_ID,{type:'activity',manufacturer:'development',product:1,timeCreated:START});
 encoder.onMesg(Profile.MesgNum.SESSION,{startTime:START,timestamp:new Date(+START+120000),
  sport:'cycling',totalTimerTime:120,totalElapsedTime:120,totalDistance:1200,avgPower:200});
 encoder.onMesg(Profile.MesgNum.LAP,{startTime:START,timestamp:new Date(+START+120000),totalTimerTime:120,totalElapsedTime:120});
 for(let i=0;i<120;i++)encoder.onMesg(Profile.MesgNum.RECORD,{
  timestamp:new Date(+START+i*1000),power:200,heartRate:135,cadence:85,
  positionLat:12345678,positionLong:-12345678
 });
 return encoder.close();
}
const JOB={source_format:'FIT',external_id:'123456',summary:{
 activityId:'123456',startTimeInSeconds:+START/1000,activityType:'INDOOR_CYCLING'
}};
const ACTIVITY={started_at:START.toISOString(),sport:'cycling'};

test('a genuine-looking synthetic cycling FIT retains measured series but excludes GPS coordinates',()=>{
 const {fit,series}=decodeApiFit(makeFit(),JOB);
 assert.equal(fit.sport,'cycling');
 assert.equal(fit.normalized_power_watts,200);
 assert.equal(series.rows.length,120);
 assert.ok(series.fields.includes('power'));
 assert.ok(series.fields.includes('heartRate'));
 assert.ok(series.fields.includes('cadence'));
 assert.equal(series.fields.includes('positionLat'),false);
 assert.equal(series.fields.includes('positionLong'),false);
 assert.equal(assertGarminApiFileIdentity(fit,JOB,ACTIVITY),true);
});

test('rejects mismatch between file and immutable Garmin notification identity',()=>{
 const fit={started_at:START.toISOString(),sport:'cycling'};
 for(const different of [
  {...JOB,external_id:'654321'},
  {...JOB,summary:{...JOB.summary,activityId:'654321'}},
  {...JOB,summary:{...JOB.summary,activityType:'RUNNING'}},
  {...JOB,summary:{...JOB.summary,startTimeInSeconds:undefined}},
  {...JOB,summary:{...JOB.summary,startTimeInSeconds:'not-a-number'}},
  {...JOB,summary:{...JOB.summary,startTimeInSeconds:JOB.summary.startTimeInSeconds+301}}
 ]) assert.throws(()=>assertGarminApiFileIdentity(fit,different),/file_activity_mismatch/);
});

test('never attaches FIT curves to a different existing calendar sport or session',()=>{
 const fit={started_at:START.toISOString(),sport:'cycling'};
 assert.throws(()=>assertGarminApiFileIdentity(fit,JOB,{...ACTIVITY,sport:'running'}),/file_activity_mismatch/);
 assert.throws(()=>assertGarminApiFileIdentity(fit,JOB,{...ACTIVITY,started_at:new Date(+START+301000).toISOString()}),/file_activity_mismatch/);
 // Date rounding within a minute can legitimately occur in synchronized summaries.
 assert.equal(assertGarminApiFileIdentity(fit,JOB,{...ACTIVITY,started_at:new Date(+START+45000).toISOString()}),true);
});

test('the decoder rejects a provider notification claiming another sport',()=>{
 assert.throws(()=>decodeApiFit(makeFit(),{...JOB,summary:{...JOB.summary,activityType:'RUNNING'}}),/file_activity_mismatch/);
});
