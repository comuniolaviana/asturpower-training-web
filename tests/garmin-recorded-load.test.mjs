import test from 'node:test';
import assert from 'node:assert/strict';
import {Encoder,Profile} from '@garmin/fitsdk';
import {analyzeFitBytes,analyzeFitDecoded,resolveHistoricalTss,derivedFitRow} from '../app/src/garmin-fit-analysis.js';
const start=new Date('2021-04-24T10:00:00Z');
function fit({records=true,session={}}={}){
 const encoder=new Encoder();encoder.onMesg(Profile.MesgNum.FILE_ID,{type:'activity',manufacturer:'development',product:1,timeCreated:start});
 encoder.onMesg(Profile.MesgNum.SESSION,{startTime:start,timestamp:new Date(start.getTime()+3600000),totalTimerTime:3600,totalElapsedTime:3600,sport:'cycling',normalizedPower:220,intensityFactor:0.88,trainingStressScore:77.5,thresholdPower:250,...session});
 if(records)for(let i=0;i<120;i++)encoder.onMesg(Profile.MesgNum.RECORD,{timestamp:new Date(start.getTime()+i*3000),power:200});return encoder.close();
}
const asRow=analysis=>({sport:analysis.sport,fit_started_at:analysis.started_at,duration_seconds:analysis.timer_seconds,...analysis});
test('official FIT SDK reads device IF, TSS and FTP without changing their scales or requiring annual thresholds',()=>{
 const analysis=analyzeFitBytes(fit());assert.equal(analysis.device_intensity_factor,0.88);assert.equal(analysis.device_tss,77.5);assert.equal(analysis.device_ftp_watts,250);
 const stored=derivedFitRow(analysis,{activity:{id:'fixture'},offset_seconds:0},[],{athleteId:'owner',archiveId:'archive',packName:'pack',fileName:'file'});
 assert.equal(stored.device_tss,77.5);assert.equal(stored.tss,null);
 const resolved=resolveHistoricalTss(asRow(analysis),[]);assert.equal(resolved.intensity_factor,0.88);assert.equal(resolved.tss,77.5);assert.equal(resolved.if_source,'garmin_recorded');assert.equal(resolved.tss_source,'garmin_recorded');assert.equal(resolved.ftp_watts,null);
});
test('a current FTP does not replace historical Garmin load; a dated confirmed FTP can recalculate it while retaining originals',()=>{
 const row=asRow(analyzeFitBytes(fit()));
 const current={sport:'cycling',effective_date:'2026-11-06',ftp:245};assert.equal(resolveHistoricalTss(row,[current]).tss,77.5);
 const historical={sport:'cycling',effective_date:'2021-01-01',ftp:200};const changed=resolveHistoricalTss(row,[current,historical]);
 assert.equal(changed.intensity_factor,1.1);assert.equal(changed.tss,121);assert.equal(changed.device_tss,77.5);assert.equal(changed.tss_source,'historical_ftp');
});
test('reported IF can determine load without guessing FTP; reported TSS alone never invents IF',()=>{
 const base={sport:'cycling',fit_started_at:start.toISOString(),duration_seconds:3600,normalized_power_watts:null};
 const fromIf=resolveHistoricalTss({...base,device_intensity_factor:0.85},[]);assert.equal(fromIf.intensity_factor,0.85);assert.equal(fromIf.tss,72.25);assert.equal(fromIf.tss_source,'garmin_session_calculated');
 const onlyTss=resolveHistoricalTss({...base,device_tss:65.4},[]);assert.equal(onlyTss.tss,65.4);assert.equal(onlyTss.intensity_factor,null);
});
test('session-only FIT preserves reported metrics without fabricating time-series records',()=>{
 const analysis=analyzeFitBytes(fit({records:false}));assert.equal(analysis.sample_count,0);assert.equal(analysis.device_tss,77.5);assert.equal(resolveHistoricalTss(asRow(analysis),[]).tss,77.5);
});
test('invalid and placeholder load values are not interpreted as measured zero',()=>{
 const decoded={messages:{sessionMesgs:[{startTime:start,totalTimerTime:120,sport:'cycling',normalizedPower:200,intensityFactor:0,trainingStressScore:0,thresholdPower:0}],recordMesgs:[{timestamp:start,power:200}]}};
 const analysis=analyzeFitDecoded(decoded);assert.equal(analysis.device_intensity_factor,null);assert.equal(analysis.device_tss,null);assert.equal(analysis.device_ftp_watts,null);
 const invalid=resolveHistoricalTss({...asRow(analysis),normalized_power_watts:null,device_intensity_factor:Infinity,device_tss:-5,device_ftp_watts:3000},[]);assert.equal(invalid.tss,null);assert.equal(invalid.intensity_factor,null);
});
test('recorded zero is retained when the session also has measured zero power',()=>{
 const decoded={messages:{sessionMesgs:[{startTime:start,totalTimerTime:120,sport:'cycling',normalizedPower:0,intensityFactor:0,trainingStressScore:0}],recordMesgs:Array.from({length:120},(_,i)=>({timestamp:new Date(+start+i*1000),power:0}))}};
 const result=resolveHistoricalTss(asRow(analyzeFitDecoded(decoded)),[]);assert.equal(result.tss,0);assert.equal(result.intensity_factor,0);assert.equal(result.tss_source,'garmin_recorded');
});
