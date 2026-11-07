import test from 'node:test';
import assert from 'node:assert/strict';
import {Encoder,Profile} from '@garmin/fitsdk';
import {zipEntries,unzipEntry} from '../app/src/garmin-original-zip.js';
import {packageStandaloneFit,inspectRecentFit} from '../app/src/garmin-single-fit-recovery.js';

const OWNER='22222222-2222-4222-8222-222222222222';
const START=new Date('2026-11-06T17:30:20Z');
function syntheticFit(){
 const e=new Encoder();
 e.onMesg(Profile.MesgNum.FILE_ID,{type:'activity',manufacturer:'development',product:1,timeCreated:START});
 e.onMesg(Profile.MesgNum.SESSION,{startTime:START,timestamp:START,totalTimerTime:1808,totalElapsedTime:1808,sport:'cycling',avgHeartRate:119,avgPower:160});
 e.onMesg(Profile.MesgNum.LAP,{startTime:START,timestamp:START,totalTimerTime:1808,totalElapsedTime:1808});
 for(let i=0;i<30;i++)e.onMesg(Profile.MesgNum.RECORD,{timestamp:new Date(+START+i*1000),heartRate:110+i%8,power:180+i,cadence:80+i%4});
 return e.close();
}
function source(bytes,name='recuperar.fit'){const f=new Blob([bytes]);Object.defineProperty(f,'name',{value:name});return f;}
function dataClient({matches=1,loggedIn=true,already=false}={}){
 let writes=0;
 const rows=Array.from({length:matches},(_,i)=>({id:i===0?'33333333-3333-4333-8333-333333333333':'44444444-4444-4444-8444-444444444444',
  started_at:START.toISOString(),sport:'cycling',source:'garmin_api',duration_seconds:1808,distance_meters:null,title:'Rodillo'}));
 return {get writes(){return writes;},auth:{getUser:async()=>({data:{user:{id:loggedIn?OWNER:'55555555-5555-4555-8555-555555555555'}}})},
  from(table){
   const q={select:()=>q,eq:()=>q,in:()=>q,gte:()=>q,lte:()=>q,
    limit:async()=>({data:rows,error:null}),maybeSingle:async()=>({data:already?{status:'ready',activity_id:rows[0].id}:null,error:null}),
    insert:async()=>{writes++;return {error:null};}};
   if(table==='activities'||table==='garmin_activity_series'||table==='garmin_fit_analysis')return q;
   throw Error('Access to unexpected table '+table);
  }};
}
test('FIT recovery ZIP preserves every original byte within official Garmin-pack path',async()=>{
 const fit=syntheticFit(),packed=packageStandaloneFit(fit),outer=new Blob([packed]);
 const entries=await zipEntries(outer);assert.equal(entries.length,1);
 assert.equal(entries[0].name,'DI_CONNECT/DI-Connect-Uploaded-Files/Recuperacion.zip');
 const inside=new Blob([await unzipEntry(outer,entries[0])]);
 const contents=await zipEntries(inside);assert.equal(contents[0].name,'recuperada.fit');
 const recovered=await unzipEntry(inside,contents[0]);
 assert.deepEqual(recovered,fit);
});
test('selects only the single existing Garmin activity, with no writes before consent',async()=>{
 const client=dataClient(),result=await inspectRecentFit(client,OWNER,source(syntheticFit()));
 assert.equal(result.match.title,'Rodillo');assert.equal(result.records,30);assert.equal(client.writes,0);
});
test('rejects ambiguous matches and changed identity without saving or manufacturing curves',async()=>{
 const bytes=source(syntheticFit()),ambiguous=dataClient({matches:2}),invalid=dataClient({loggedIn:false});
 await assert.rejects(inspectRecentFit(ambiguous,OWNER,bytes),/no coincide de forma única/);
 await assert.rejects(inspectRecentFit(invalid,OWNER,bytes),/titular/);
 assert.equal(ambiguous.writes,0);assert.equal(invalid.writes,0);
});
test('refuses overwriting a complete activity and rejects non-FIT uploads',async()=>{
 const bytes=source(syntheticFit()),client=dataClient({already:true});
 await assert.rejects(inspectRecentFit(client,OWNER,bytes),/curvas guardadas/);
 await assert.rejects(inspectRecentFit(dataClient(),OWNER,source(syntheticFit(),'archivo.zip')),/FIT original/);
 assert.equal(client.writes,0);
});
