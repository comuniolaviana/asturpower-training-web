import test from 'node:test';
import assert from 'node:assert/strict';
import {Encoder,Profile} from '@garmin/fitsdk';
import {createHash} from 'node:crypto';
import {deflateRawSync} from 'node:zlib';
import {crc32} from '../app/src/garmin-original-zip.js';
import {originalIdentity} from '../app/src/garmin-original-vault.js';
import {processGarminFitArchive,readAnalysisSummary} from '../app/src/garmin-fit-analysis-runner.js';

const OWNER='22222222-2222-4222-8222-222222222222',ACTIVITY='33333333-3333-4333-8333-333333333333';
const START=new Date('2026-05-02T10:00:00Z');
function zip(name,data){
 const payload=new Uint8Array(deflateRawSync(data)),named=new TextEncoder().encode(name);
 const local=30+named.length+payload.length,cd=46+named.length,out=new Uint8Array(local+cd+22),v=new DataView(out.buffer);
 v.setUint32(0,0x04034b50,true);v.setUint16(4,20,true);v.setUint16(8,8,true);
 v.setUint32(14,crc32(data),true);v.setUint32(18,payload.length,true);
 v.setUint32(22,data.length,true);v.setUint16(26,named.length,true);
 out.set(named,30);out.set(payload,30+named.length);
 v.setUint32(local,0x02014b50,true);v.setUint16(local+10,8,true);
 v.setUint32(local+16,crc32(data),true);v.setUint32(local+20,payload.length,true);
 v.setUint32(local+24,data.length,true);v.setUint16(local+28,named.length,true);
 out.set(named,local+46);
 const end=local+cd;v.setUint32(end,0x06054b50,true);v.setUint16(end+8,1,true);
 v.setUint16(end+10,1,true);v.setUint32(end+12,cd,true);v.setUint32(end+16,local,true);
 return out;
}
function fit(){
 const e=new Encoder();
 e.onMesg(Profile.MesgNum.FILE_ID,{type:'activity',manufacturer:'development',product:1,timeCreated:START});
 e.onMesg(Profile.MesgNum.SESSION,{startTime:START,timestamp:new Date(START.getTime()+120000),
  totalTimerTime:120,totalElapsedTime:120,totalDistance:1000,sport:'cycling',avgPower:200});
 e.onMesg(Profile.MesgNum.LAP,{startTime:START,timestamp:new Date(START.getTime()+120000),totalTimerTime:120,totalElapsedTime:120});
 for(let i=0;i<120;i++)e.onMesg(Profile.MesgNum.RECORD,{timestamp:new Date(START.getTime()+i*1000),power:200,
  heartRate:120,positionLat:12345678,positionLong:-12345678});
 return new Uint8Array(e.close());
}
async function fixture(){
 const bytes=fit(),internal='private_session_123.fit';
 const packPath='DI_CONNECT/DI-Connect-Uploaded-Files/UploadedFiles_0-_Part1.zip';
 const pack=zip(internal,bytes),outer=zip(packPath,pack);
 const chunk={size:outer.length,sha256:createHash('sha256').update(outer).digest('hex')};
 const archiveId=await originalIdentity([chunk],outer.length);
 const catalog=[{owner_id:OWNER,archive_id:archiveId,pack_name:packPath,entries:[{name:internal,kind:'FIT',byte_size:bytes.length}]}];
 const analyses=[],progress=[],ftps=[];
 const activity={id:ACTIVITY,started_at:START.toISOString(),sport:'cycling',duration_seconds:120,distance_meters:1000,external_id:'12345'};
 let calls=0;
 const client={auth:{getUser:async()=>({data:{user:{id:OWNER}},error:null})},
  storage:{from:()=>({download:async()=>({data:new Blob([outer]),error:null})})},
  from(table){
   if(table==='garmin_original_archives'){
    const b={select(){return b;},eq(){return b;},single:async()=>({data:{archive_id:archiveId,filename:'export.zip',
      byte_size:outer.length,status:'ready',chunks:[chunk]},error:null})};return b;
   }
   const b={select(){return b;},eq(){return b;},in(){return b;},gte(){return b;},lt(){return b;},
    order(){return b;},limit(){return b;},range(start,end){
     const rows=table==='garmin_fit_analysis'?analyses:table==='activities'?[activity]:[];
     return Promise.resolve({data:rows.slice(start,end+1),error:null});
    },
    then(resolve){
     const rows=table==='garmin_original_catalog'?catalog:
      table==='garmin_fit_scan_progress'?progress:
      table==='athlete_physiology'?ftps:[];
     return Promise.resolve({data:rows,error:null}).then(resolve);
    },
    async insert(row){
     assert.equal(table,'garmin_fit_analysis');calls++;if(analyses.some(x=>x.activity_id===row.activity_id))return {error:{code:'23505'}};
     analyses.push(row);return {error:null};
    },
    async upsert(row){
     assert.equal(table,'garmin_fit_scan_progress');const i=progress.findIndex(x=>x.pack_name===row.pack_name);
     if(i>=0)progress[i]=row;else progress.push(row);return {error:null};
    }
   };return b;
  }};
 return {client,archiveId,analyses,progress,ftps,get writes(){return calls;}};
}
test('FIT scanner links real session, computes NP, saves checkpoint, and resuming does not duplicate',async()=>{
 const f=await fixture(),first=await processGarminFitArchive(f.client,OWNER,f.archiveId);
 assert.equal(first.scanned,1);assert.equal(first.newLinks,1);assert.equal(first.newNormalizedPower,1);
 assert.equal(first.newTss,0);assert.equal(first.missingFtp,true);
 assert.equal(f.writes,1);assert.equal(f.analyses[0].activity_id,ACTIVITY);
 assert.equal(f.analyses[0].normalized_power_watts,200);assert.equal(f.analyses[0].tss,null);
 assert.equal(f.progress[0].next_index,1);
 const again=await processGarminFitArchive(f.client,OWNER,f.archiveId);
 assert.equal(again.newLinks,0);assert.equal(f.writes,1);
 // Historical FTP added AFTER the FIT scan: no 12k-file reprocessing needed.
 f.ftps.push({sport:'cycling',ftp:250,effective_date:'2026-01-01',created_at:'2026-01-02T00:00:00Z'});
 const display=await readAnalysisSummary(f.client,OWNER,f.archiveId);
 assert.equal(display.analysis[0].tss,Number((120/3600*0.8*0.8*100).toFixed(3)));
});
