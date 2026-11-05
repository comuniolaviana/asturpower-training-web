import test from 'node:test';
import assert from 'node:assert/strict';
import {Encoder,Profile} from '@garmin/fitsdk';
import {deflateRawSync} from 'node:zlib';
import {JSDOM} from 'jsdom';
import {sha256,describeOriginal,originalIdentity,uploadOriginal,downloadOriginal,ORIGINAL_CHUNK_BYTES} from '../app/src/garmin-original-vault.js';
import {decodeCompleteFit} from '../app/src/garmin-full-fit.js';
import {zipEntries,unzipEntry,crc32} from '../app/src/garmin-original-zip.js';
import {mountOriginalVault} from '../app/src/garmin-original-ui.js';
const USER='22222222-2222-4222-8222-222222222222';
function file(bytes,name='original.zip'){const f=new Blob([bytes]);Object.defineProperty(f,'name',{value:name});return f;}
function fixture(){
 const state={actor:USER,rows:new Map(),objects:new Map(),writes:0,uploads:0,failAt:null};
 const client={auth:{getUser:async()=>({data:{user:{id:state.actor}},error:null})},
  async rpc(name,p){
   if(name==='reserve_garmin_original'){
    assert.equal(p.p_consent,true);
    const prior=state.rows.get(p.p_archive_id);if(prior)return {data:prior,error:null};
    const row={archive_id:p.p_archive_id,filename:p.p_filename,byte_size:p.p_byte_size,
     chunks:p.p_chunks.map(c=>({size:c.size,sha256:c.sha256})),status:'uploading',owner_id:USER};
    state.rows.set(row.archive_id,row);state.writes++;return {data:row,error:null};
   }
   const row=state.rows.get(p.p_archive_id);row.status='ready';return {data:row,error:null};
  },
  storage:{from(bucket){assert.equal(bucket,'garmin-originals');return {
   async upload(path,blob,options){
    assert.equal(options.upsert,false);assert.equal(path.split('/')[0],USER);assert.ok(blob.size<=ORIGINAL_CHUNK_BYTES);
    state.uploads++;if(state.failAt===state.uploads)return {error:{statusCode:'503'}};
    if(state.objects.has(path))return {error:{statusCode:'400',code:'Duplicate'}};
    state.objects.set(path,blob);return {data:{path},error:null};
   },async download(path){return {data:state.objects.get(path)||null,error:null};}
  };}},
  from(table){assert.equal(table,'garmin_original_archives');let id=null;
   const b={select(){return b;},eq(k,v){if(k==='archive_id')id=v;else assert.equal(v,USER);return b;},order(){return b;},limit(){return b;},
    single:async()=>({data:state.rows.get(id),error:null}),then(resolve){return Promise.resolve({data:[...state.rows.values()],error:null}).then(resolve);}};return b;
  }};return {client,state};
}
function syntheticFit(){
 const e=new Encoder(),date=new Date('2020-01-02T10:00:00Z');
 e.onMesg(Profile.MesgNum.FILE_ID,{type:'activity',manufacturer:'development',product:1,timeCreated:date});
 e.onMesg(Profile.MesgNum.SESSION,{startTime:date,timestamp:date,totalTimerTime:60,totalElapsedTime:60,sport:'cycling',avgPower:153});
 e.onMesg(Profile.MesgNum.LAP,{startTime:date,timestamp:date,totalTimerTime:60,totalElapsedTime:60,avgPower:153});
 for(let i=0;i<61;i++)e.onMesg(Profile.MesgNum.RECORD,{timestamp:new Date(date.getTime()+i*1000),power:100+i,heartRate:100+i%20,cadence:80,positionLat:12345678,positionLong:-12345678});
 return e.close();
}
function zip(name,data,{compressed=false}={}){
 const nb=new TextEncoder().encode(name),body=compressed?new Uint8Array(deflateRawSync(data)):data;
 const local=30+nb.length+body.length,cd=46+nb.length,b=new Uint8Array(local+cd+22),v=new DataView(b.buffer);
 v.setUint32(0,0x04034b50,true);v.setUint16(4,20,true);v.setUint16(8,compressed?8:0,true);v.setUint32(14,crc32(data),true);v.setUint32(18,body.length,true);v.setUint32(22,data.length,true);v.setUint16(26,nb.length,true);b.set(nb,30);b.set(body,30+nb.length);
 v.setUint32(local,0x02014b50,true);v.setUint16(local+10,compressed?8:0,true);v.setUint32(local+16,crc32(data),true);v.setUint32(local+20,body.length,true);v.setUint32(local+24,data.length,true);v.setUint16(local+28,nb.length,true);b.set(nb,local+46);
 const end=local+cd;v.setUint32(end,0x06054b50,true);v.setUint16(end+8,1,true);v.setUint16(end+10,1,true);v.setUint32(end+12,cd,true);v.setUint32(end+16,local,true);return b;
}
test('original manifest is byte-based, ordered, stable across JSONB key order and independent of filename',async()=>{
 const bytes=new Uint8Array(ORIGINAL_CHUNK_BYTES+7);bytes.fill(37);bytes[bytes.length-1]=250;
 const a=await describeOriginal(file(bytes)),b=await describeOriginal(file(bytes,'renamed.zip'));
 assert.equal(a.archive_id,b.archive_id);assert.equal(a.chunks.length,2);assert.equal(a.byte_size,bytes.length);
 assert.equal(a.archive_id,await originalIdentity(a.chunks.map(c=>({size:c.size,sha256:c.sha256})),a.byte_size));
 bytes[bytes.length-1]=251;assert.notEqual(a.archive_id,(await describeOriginal(file(bytes))).archive_id);
});
test('upload and reconstruction retain every original byte including opaque data and trailing bytes',async()=>{
 const {client,state}=fixture(),bytes=new Uint8Array(ORIGINAL_CHUNK_BYTES+123);for(let i=0;i<bytes.length;i++)bytes[i]=i%251;
 const uploaded=await uploadOriginal(client,USER,file(bytes)),downloaded=await downloadOriginal(client,USER,uploaded.archive_id);
 assert.deepEqual(new Uint8Array(await downloaded.blob.arrayBuffer()),bytes);assert.equal(state.objects.size,2);
 const again=await uploadOriginal(client,USER,file(bytes));assert.equal(again.already_saved,true);assert.equal(state.objects.size,2);
 const streamed=[];const result=await downloadOriginal(client,USER,uploaded.archive_id,{onChunk:async b=>streamed.push(new Uint8Array(b))});
 assert.equal(result.blob,null);assert.equal(streamed.reduce((n,c)=>n+c.length,0),bytes.length);
});
test('an interrupted upload resumes by verifying existing chunks and never overwrites them',async()=>{
 const {client,state}=fixture(),bytes=new Uint8Array(ORIGINAL_CHUNK_BYTES+10);state.failAt=2;
 await assert.rejects(uploadOriginal(client,USER,file(bytes)),/interrumpido/);assert.equal(state.objects.size,1);
 state.failAt=null;const saved=await uploadOriginal(client,USER,file(bytes));assert.equal(saved.already_saved,false);assert.equal(state.objects.size,2);
});
test('corruption is detected on download; no altered original is returned',async()=>{
 const {client,state}=fixture(),saved=await uploadOriginal(client,USER,file(new Uint8Array([1,2,3])));
 const key=[...state.objects.keys()][0];state.objects.set(key,new Blob([new Uint8Array([1,2,4])]));
 await assert.rejects(downloadOriginal(client,USER,saved.archive_id),/integridad/);
});
test('changed identity and cancellation stop before reserve or writes',async()=>{
 const {client,state}=fixture();state.actor='33333333-3333-4333-8333-333333333333';
 await assert.rejects(uploadOriginal(client,USER,file(new Uint8Array([1]))),/sesión/);assert.equal(state.writes,0);
 state.actor=USER;const c=new AbortController();c.abort();await assert.rejects(uploadOriginal(client,USER,file(new Uint8Array([1])),{signal:c.signal}),{name:'AbortError'});assert.equal(state.writes,0);
});
test('official FIT reader retains all samples, GPS, laps and instantaneous power rather than only averages',()=>{
 const decoded=decodeCompleteFit(syntheticFit());assert.equal(decoded.messages.recordMesgs.length,61);assert.equal(decoded.messages.lapMesgs.length,1);
 assert.equal(decoded.messages.recordMesgs[60].power,160);assert.equal(decoded.messages.recordMesgs[0].positionLat,12345678);
 assert.ok(decoded.messages.recordMesgs[0].timestamp instanceof Date);assert.equal(decoded.messages.sessionMesgs[0].avgPower,153);
 const corrupted=syntheticFit();corrupted[corrupted.length-1]^=1;assert.throws(()=>decodeCompleteFit(corrupted),/integridad/);
});
test('ZIP browser includes unknown and personal JSON entries and verifies deflate bytes and CRC',async()=>{
 const bytes=new TextEncoder().encode('{"opaque":"preserved"}');
 for(const compressed of [false,true]){
  const blob=new Blob([zip('DI_CONNECT/private.json',bytes,{compressed})]),entries=await zipEntries(blob);
  assert.equal(entries.length,1);assert.equal(entries[0].name,'DI_CONNECT/private.json');assert.deepEqual(await unzipEntry(blob,entries[0]),bytes);
  await assert.rejects(unzipEntry(blob,{...entries[0],crc:0}),/ZIP/);
 }
 await assert.rejects(zipEntries(new Blob(['not a zip'])),/ZIP/);
});
test('ZIP64 directory locator is decoded without truncating 64-bit counts or offsets',async()=>{
 const data=new Uint8Array([1,2,3]),raw=zip('activity.fit',data),old=new DataView(raw.buffer),end=raw.length-22;
 const bytes=new Uint8Array(raw.length+76),v=new DataView(bytes.buffer);bytes.set(raw.subarray(0,end));
 v.setUint32(end,0x06064b50,true);v.setBigUint64(end+4,44n,true);v.setUint16(end+12,45,true);v.setUint16(end+14,45,true);
 v.setBigUint64(end+24,1n,true);v.setBigUint64(end+32,1n,true);v.setBigUint64(end+40,BigInt(old.getUint32(end+12,true)),true);v.setBigUint64(end+48,BigInt(old.getUint32(end+16,true)),true);
 v.setUint32(end+56,0x07064b50,true);v.setBigUint64(end+64,BigInt(end),true);v.setUint32(end+72,1,true);bytes.set(raw.subarray(end),end+76);
 v.setUint16(end+76+8,65535,true);v.setUint16(end+76+10,65535,true);v.setUint32(end+76+12,0xffffffff,true);v.setUint32(end+76+16,0xffffffff,true);
 const blob=new Blob([bytes]),entries=await zipEntries(blob);assert.equal(entries.length,1);assert.deepEqual(await unzipEntry(blob,entries[0]),data);
});
test('ZIP64 extra fields preserve entry sizes before decompression bounds are checked',async()=>{
 const data=new Uint8Array([4,5,6]),raw=zip('activity.fit',data),old=new DataView(raw.buffer),end=raw.length-22,cd=old.getUint32(end+16,true);
 const bytes=new Uint8Array(raw.length+20),v=new DataView(bytes.buffer);bytes.set(raw.subarray(0,end));bytes.set(raw.subarray(end),end+20);
 v.setUint16(cd+30,20,true);v.setUint32(cd+20,0xffffffff,true);v.setUint32(cd+24,0xffffffff,true);
 v.setUint16(end,1,true);v.setUint16(end+2,16,true);v.setBigUint64(end+4,3n,true);v.setBigUint64(end+12,3n,true);v.setUint32(end+20+12,old.getUint32(end+12,true)+20,true);
 const blob=new Blob([bytes]),entries=await zipEntries(blob);assert.equal(entries[0].size,3);assert.equal(entries[0].compressed,3);assert.deepEqual(await unzipEntry(blob,entries[0]),data);
});
test('UI requires explicit full-file consent, exposes owner-only scope and never uploads on selection',async()=>{
 const dom=new JSDOM('<main id="root"></main>'),root=dom.window.document.getElementById('root'),{client,state}=fixture();
 const dispose=mountOriginalVault({root,client,user:{id:USER},role:'athlete'});
 try{
  const input=root.querySelector('input[type=file]'),send=[...root.querySelectorAll('button')].find(b=>b.textContent==='Guardar original completo');
  assert.equal(send.disabled,true);assert.match(root.textContent,/solo son accesibles para ti/);
  Object.defineProperty(input,'files',{value:[file(new Uint8Array([1,2,3]))]});input.dispatchEvent(new dom.window.Event('change'));
  await new Promise(r=>setTimeout(r,0));assert.equal(state.writes,0);assert.equal(send.disabled,true);
  const consent=root.querySelector('input[type=checkbox]');consent.checked=true;consent.dispatchEvent(new dom.window.Event('change'));assert.equal(send.disabled,false);
  assert.equal(root.querySelector('a[href*="storage"]'),null);
 }finally{dispose();dom.window.close();}
});
