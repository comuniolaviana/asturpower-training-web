import test from 'node:test';
import assert from 'node:assert/strict';
import {Encoder,Profile} from '@garmin/fitsdk';
import {normalizedPower,analyzeFitBytes,matchFitActivity,ftpForDate,derivedFitRow,partialLoadCurve} from '../app/src/garmin-fit-analysis.js';
const ATHLETE='22222222-2222-4222-8222-222222222222';
const DATE=new Date('2026-05-02T10:00:00Z');
function realFit(){
 const encoder=new Encoder();
 encoder.onMesg(Profile.MesgNum.FILE_ID,{type:'activity',manufacturer:'development',product:1,timeCreated:DATE});
 encoder.onMesg(Profile.MesgNum.SESSION,{startTime:DATE,timestamp:new Date(DATE.getTime()+120000),sport:'cycling',
  totalTimerTime:120,totalElapsedTime:120,totalDistance:1000,avgPower:200});
 encoder.onMesg(Profile.MesgNum.LAP,{startTime:DATE,timestamp:new Date(DATE.getTime()+120000),totalTimerTime:120,totalElapsedTime:120});
 for(let i=0;i<120;i++)encoder.onMesg(Profile.MesgNum.RECORD,{timestamp:new Date(DATE.getTime()+i*1000),
  power:200,heartRate:130,cadence:80,positionLat:12345678,positionLong:-12345678});
 return encoder.close();
}
test('normalized power from 1-Hz FIT samples is 200 W for constant 200 W, not mean of missing timestamps',()=>{
 const records=Array.from({length:120},(_,i)=>({timestamp:new Date(DATE.getTime()+i*1000),power:200}));
 const np=normalizedPower(records,120);
 assert.equal(np.np,200);assert.equal(np.powerSeconds,120);assert.equal(np.coverage,1);
 assert.equal(normalizedPower(records.filter((_,i)=>i%3===0),120).np,null);
 assert.equal(normalizedPower(records.map(r=>({...r,power:undefined})),120).np,null);
});
test('FIT activity is identified from internal session messages, never its filename',()=>{
 const data=analyzeFitBytes(realFit());
 assert.ok(data);assert.equal(data.sport,'cycling');assert.equal(data.timer_seconds,120);
 assert.equal(data.normalized_power_watts,200);assert.equal(data.sample_count,120);
 assert.equal(data.started_at,DATE.toISOString());
});
test('attach only one high-confidence date, sport, duration and distance match',()=>{
 const fit={started_at:DATE.toISOString(),sport:'cycling',timer_seconds:3600,distance_meters:32000,
  normalized_power_watts:200,power_seconds:3590,power_coverage:0.997,sample_count:3590};
 const rows=[{id:'a',started_at:DATE.toISOString(),sport:'cycling',duration_seconds:3600,distance_meters:32000},
  {id:'b',started_at:new Date(DATE.getTime()+86400000).toISOString(),sport:'cycling',duration_seconds:3600,distance_meters:32000}];
 const match=matchFitActivity(fit,rows);assert.equal(match.activity.id,'a');
 assert.equal(matchFitActivity(fit,[rows[0],{...rows[0],id:'c'}]),null);
 assert.equal(matchFitActivity(fit,[{...rows[0],sport:'running'}]),null);
 assert.equal(matchFitActivity(fit,[{...rows[0],distance_meters:60000}]),null);
 assert.equal(matchFitActivity(fit,[{...rows[0],started_at:new Date(DATE.getTime()+3600000).toISOString()}]),null);
});
test('TSS requires FTP valid at session date and does not use later FTP',()=>{
 const fit={started_at:DATE.toISOString(),sport:'cycling',timer_seconds:3600,distance_meters:32000,
  normalized_power_watts:200,power_seconds:3600,power_coverage:1,sample_count:3600};
 const matched={activity:{id:'1'},offset_seconds:0};
 const cfg={athleteId:ATHLETE,archiveId:'f'.repeat(64),packName:'part1.zip',fileName:'session.fit'};
 const without=derivedFitRow(fit,matched,[],cfg);
 assert.equal(without.normalized_power_watts,200);assert.equal(without.tss,null);assert.equal(without.ftp_watts,null);
 const history=[{sport:'cycling',ftp:250,effective_date:'2026-01-01',created_at:'2026-01-03T00:00:00Z'},
 {sport:'cycling',ftp:280,effective_date:'2026-08-01',created_at:'2026-08-01T00:00:00Z'}];
 assert.equal(ftpForDate(history,'2026-05-02').ftp,250);
 const row=derivedFitRow(fit,matched,history,cfg);
 assert.equal(row.intensity_factor,0.8);assert.equal(row.tss,64);
 assert.equal(row.ftp_watts,250);assert.equal(row.ftp_effective_date,'2026-01-01');
});
test('CTL/ATL/TSB preview is explicitly partial to known TSS and cannot infer missing activity data',()=>{
 const records=[{sport:'cycling',tss:100,fit_started_at:'2026-05-01T09:00:00Z'}];
 const curve=partialLoadCurve(records,{from:'2026-05-01',to:'2026-05-03'});
 assert.equal(curve.length,3);assert.equal(curve[0].known_cycling_tss,100);
 assert.ok(curve[0].partial_atl>curve[0].partial_ctl);
 assert.equal(curve[0].partial_tsb,0);
});
