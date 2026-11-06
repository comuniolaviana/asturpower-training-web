import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {deflateRawSync} from 'node:zlib';
import {previewGarminHistory,saveGarminHistory} from '../app/src/garmin-history-import.js';
import {crc32} from '../app/src/garmin-original-zip.js';
import {originalIdentity} from '../app/src/garmin-original-vault.js';
const OWNER='22222222-2222-4222-8222-222222222222';
function zip(name,data){
 const source=new TextEncoder().encode(JSON.stringify(data)),payload=new Uint8Array(deflateRawSync(source));
 const named=new TextEncoder().encode(name),local=30+named.length+payload.length,cd=46+named.length;
 const bytes=new Uint8Array(local+cd+22),v=new DataView(bytes.buffer);
 v.setUint32(0,0x04034b50,true);v.setUint16(4,20,true);v.setUint16(8,8,true);v.setUint32(14,crc32(source),true);
 v.setUint32(18,payload.length,true);v.setUint32(22,source.length,true);v.setUint16(26,named.length,true);
 bytes.set(named,30);bytes.set(payload,30+named.length);
 v.setUint32(local,0x02014b50,true);v.setUint16(local+10,8,true);v.setUint32(local+16,crc32(source),true);
 v.setUint32(local+20,payload.length,true);v.setUint32(local+24,source.length,true);v.setUint16(local+28,named.length,true);
 bytes.set(named,local+46);const end=local+cd;
 v.setUint32(end,0x06054b50,true);v.setUint16(end+8,1,true);v.setUint16(end+10,1,true);
 v.setUint32(end+12,cd,true);v.setUint32(end+16,local,true);return bytes;
}
async function fixture(){
 const example={activityId:983211,name:'Entrenamiento de prueba',sportType:'CYCLING',
  startTimeGmt:Date.UTC(2025,2,3,10),duration:3600000,distance:3000000,elevationGain:25000,
  avgHr:137,avgPower:165};
 const data=[{summarizedActivitiesExport:[example,{...example,activityId:983212,duration:0}]}];
 const bytes=zip('DI_CONNECT/DI-Connect-Fitness/test_1_summarizedActivities.json',data);
 const part={size:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')};
 const archiveId=await originalIdentity([part],bytes.length),records=new Map();let requests=0,actor=OWNER;
 const client={auth:{getUser:async()=>({data:{user:{id:actor}},error:null})},storage:{from:()=>({download:async()=>{requests++;return {data:new Blob([bytes]),error:null};}})},
  from(name){if(name==='garmin_original_archives'){
   const b={select:()=>b,eq:()=>b,single:async()=>({data:{archive_id:archiveId,byte_size:bytes.length,filename:'export.zip',status:'ready',chunks:[part]},error:null})};return b;
  }if(name==='activities'){
   const b={select:()=>b,eq:()=>b,in:()=>b,then:cb=>Promise.resolve({data:[...records.values()].map(r=>({source:r.source,external_id:r.external_id})),error:null}).then(cb),
    insert:async rows=>{for(const row of rows){if(row.athlete_id!==OWNER||row.source!=='garmin_export')return {error:{message:'not allowed'}};records.set(row.external_id,row);}return {error:null};}};return b;
  }throw Error('Invalid table');}
 };
 return {client,archiveId,records,setActor:id=>actor=id,requests:()=>requests};
}
test('read validated export ZIP from private immutable chunks without uploading the archive again',async()=>{
 const f=await fixture(),preview=await previewGarminHistory(f.client,OWNER,f.archiveId);
 assert.equal(preview.seen,2);assert.equal(preview.rows.length,1);assert.equal(preview.skipped,1);
 const row=preview.rows[0];assert.equal(row.sport,'cycling');assert.equal(row.distance_meters,30000);
 assert.equal(row.elevation_gain_meters,250);assert.equal(row.duration_seconds,3600);
 assert.equal(row.avg_power_watts,165);assert.equal(f.requests(),1);
 const first=await saveGarminHistory(f.client,OWNER,preview.rows);
 assert.deepEqual(first,{imported:1,existing:0,total:1});
 const again=await saveGarminHistory(f.client,OWNER,preview.rows);
 assert.deepEqual(again,{imported:0,existing:1,total:1});
 assert.equal(f.records.size,1);
});
test('reject access when logged-in identity is not the owner',async()=>{
 const f=await fixture();f.setActor('33333333-3333-4333-8333-333333333333');
 await assert.rejects(previewGarminHistory(f.client,OWNER,f.archiveId),/sesión/);
 assert.equal(f.requests(),0);
});
