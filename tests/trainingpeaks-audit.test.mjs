import test from 'node:test';
import assert from 'node:assert/strict';
import {parseTrainingPeaksSummary,compareTrainingPeaks,splitCsv} from '../app/src/trainingpeaks-audit.js';

const TP='WorkoutDay,WorkoutType,TssActual,TotalTime,TssCalculationMethod,Completed\n';
const activity=(id,date,seconds=3600,sport='cycling')=>({id,title:'Sesión de prueba',sport,started_at:date+'T12:00:00Z',duration_seconds:seconds});

test('TrainingPeaks summary separates actual from planned and parses quoting, delimiters and decimal commas',()=>{
 const text='\uFEFFWorkoutDay;WorkoutType;TssActual;TotalTime;TssPlanned;Completed;TssCalculationMethod\n'+
  '2026-11-06;Bike;72,5;1,5;100;true;Power\n'+
  '2026-11-07;Bike;;2;180;false;Power\n'+
  '2026-11-08;Strength;35;1;120;true;"HeartRate; RPE"\n';
 const parsed=parseTrainingPeaksSummary(text);
 assert.equal(parsed.recognized,2);assert.equal(parsed.skipped,1);
 assert.equal(parsed.entries[0].tss,72.5);assert.equal(parsed.entries[0].seconds,5400);
 assert.equal(parsed.entries[2].method,'HeartRate; RPE');
 assert.equal(parsed.entries[1].status,'skipped');
 assert.deepEqual(splitCsv('a,b\n"quoted, value","two ""quotes"""'),[['a','b'],['quoted, value','two "quotes"']]);
});
test('required completed TSS is never replaced by planned TSS',()=>{
 assert.throws(()=>parseTrainingPeaksSummary('WorkoutDay,WorkoutType,TssPlanned,TotalTime\n2026-11-06,Bike,90,1'),/TssActual/);
 assert.throws(()=>parseTrainingPeaksSummary(TP+'2026-11-06,Bike,70,1,Power,true\n"unterminated'),/comillas/i);
 const parsed=parseTrainingPeaksSummary(TP+'2026-11-06,Bike,70,1,Power,true\n2026-11-06,Bike,66,0,Power,true');
 assert.equal(parsed.recognized,1);assert.equal(parsed.skipped,1);
});
test('matches require same day, sport and close duration, preserve source and report missing Garmin TSS',()=>{
 const parsed=parseTrainingPeaksSummary(TP+
  '2026-11-05,Bike,50,1,Power,true\n'+
  '2026-11-06,Bike,80,1,HeartRate,true\n'+
  '2026-11-07,Run,45,1,Running,true\n'+
  '2026-11-08,Bike,44,1,Power,true\n');
 const acts=[activity('a','2026-11-05'),activity('b','2026-11-06'),activity('c','2026-11-07',3600,'running')];
 const metrics=[{activity_id:'a',tss:51,tss_source:'garmin_recorded'},{activity_id:'b',tss:42,tss_source:'garmin_session_calculated'}];
 const result=compareTrainingPeaks({entries:parsed.entries,activities:acts,metrics});
 assert.deepEqual(result.counts,{comparable:1,different:1,missing:1,ambiguous:0,unmatched:1,skipped:0});
 assert.equal(result.results[1].difference,-38);
 assert.equal(result.results[1].garminSource,'garmin_session_calculated');
 assert.equal(result.results[2].status,'missing');
});
test('multiple possible activities and repeated CSV rows remain ambiguous rather than guessed',()=>{
 const rows=parseTrainingPeaksSummary(TP+'2026-11-06,Bike,80,1,Power,true\n2026-11-06,Bike,80,1,Power,true');
 const one=compareTrainingPeaks({entries:rows.entries,activities:[activity('a','2026-11-06')],metrics:[]});
 assert.equal(one.counts.ambiguous,2);
 const ambiguous=compareTrainingPeaks({entries:rows.entries.slice(0,1),activities:[activity('a','2026-11-06'),activity('b','2026-11-06')],metrics:[]});
 assert.equal(ambiguous.counts.ambiguous,1);
 const noDuration=compareTrainingPeaks({entries:rows.entries.slice(0,1),activities:[activity('a','2026-11-06',600)],metrics:[]});
 assert.equal(noDuration.counts.unmatched,1);
});
test('zero actual TSS is a real zero, unsupported sports are skipped and formula text is treated as plain text',()=>{
 const rows=parseTrainingPeaksSummary(TP+'2026-11-06,Bike,0,1,=CMD,true\n2026-11-06,Kitesurf,55,1,Power,true');
 assert.equal(rows.recognized,1);assert.equal(rows.skipped,1);
 const compared=compareTrainingPeaks({entries:rows.entries,activities:[activity('a','2026-11-06')],metrics:[{activity_id:'a',tss:0}]});
 assert.equal(compared.results[0].status,'comparable');
 assert.equal(compared.results[0].method,'=CMD');
});
