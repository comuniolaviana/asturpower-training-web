import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,createHash} from 'node:crypto';
import {deflateRawSync} from 'node:zlib';
import {zipEntries,unzipEntry,crc32} from '../app/src/garmin-original-zip.js';
import {openPrivateGarminArchive} from '../app/src/garmin-history-import.js';
import {originalIdentity,ORIGINAL_CHUNK_BYTES} from '../app/src/garmin-original-vault.js';
const OWNER='22222222-2222-4222-8222-222222222222';
function zip(name,data,{compress=false}={}){
 const raw=data instanceof Uint8Array?data:new Uint8Array(data);
 const payload=compress?new Uint8Array(deflateRawSync(raw)):raw;
 const nameBytes=new TextEncoder().encode(name),local=30+nameBytes.length+payload.length,cd=46+nameBytes.length;
 const output=new Uint8Array(local+cd+22),v=new DataView(output.buffer);
 v.setUint32(0,0x04034b50,true);v.setUint16(4,20,true);
 v.setUint16(8,compress?8:0,true);v.setUint32(14,crc32(raw),true);
 v.setUint32(18,payload.length,true);v.setUint32(22,raw.length,true);v.setUint16(26,nameBytes.length,true);
 output.set(nameBytes,30);output.set(payload,30+nameBytes.length);
 v.setUint32(local,0x02014b50,true);v.setUint16(local+10,compress?8:0,true);
 v.setUint32(local+16,crc32(raw),true);v.setUint32(local+20,payload.length,true);
 v.setUint32(local+24,raw.length,true);v.setUint16(local+28,nameBytes.length,true);
 output.set(nameBytes,local+46);const end=local+cd;
 v.setUint32(end,0x06054b50,true);v.setUint16(end+8,1,true);v.setUint16(end+10,1,true);
 v.setUint32(end+12,cd,true);v.setUint32(end+16,local,true);return output;
}
test('a large nested Garmin ZIP is read from private 4 MiB chunks, not a single full archive request',async()=>{
 // Incompressible synthetic bytes make the INNER archive exceed the old 32 MiB remote read cap.
 const pad=new Uint8Array(randomBytes(33*1024*1024+37));
 const inner=zip('test.fit',pad);
 const outer=zip('DI_CONNECT/DI-Connect-Uploaded-Files/UploadedFiles_0-_Part3.zip',inner,{compress:true});
 const chunks=[];
 for(let start=0;start<outer.length;start+=ORIGINAL_CHUNK_BYTES){
  const part=outer.subarray(start,start+ORIGINAL_CHUNK_BYTES);
  chunks.push({size:part.length,sha256:createHash('sha256').update(part).digest('hex')});
 }
 const archiveId=await originalIdentity(chunks,outer.length);let requests=0;
 const client={auth:{getUser:async()=>({data:{user:{id:OWNER}},error:null})},
  from(table){
   assert.equal(table,'garmin_original_archives');
   const b={select(){return b;},eq(){return b;},single:async()=>({error:null,
    data:{archive_id:archiveId,byte_size:outer.length,status:'ready',filename:'garmin.zip',chunks}})};
   return b;
  },
  storage:{from(bucket){
   assert.equal(bucket,'garmin-originals');
   return {download:async path=>{
    requests++;const index=Number(path.split('/')[2].slice(0,6)),start=index*ORIGINAL_CHUNK_BYTES;
    return {error:null,data:new Blob([outer.subarray(start,start+chunks[index].size)])};
   }};
  }},
 };
 const {blob}=await openPrivateGarminArchive(client,OWNER,archiveId);
 const entries=await zipEntries(blob);
 assert.equal(entries.length,1);
 assert.ok(entries[0].compressed>32*1024*1024);
 const unpacked=await unzipEntry(blob,entries[0],64*1024*1024);
 assert.equal(unpacked.length,inner.length);
 const nested=await zipEntries(new Blob([unpacked]));
 assert.equal(nested[0].name,'test.fit');
 const recovered=await unzipEntry(new Blob([unpacked]),nested[0],40*1024*1024);
 assert.deepEqual(createHash('sha256').update(recovered).digest('hex'),createHash('sha256').update(pad).digest('hex'));
 assert.ok(requests>1);assert.ok(requests<=chunks.length+3);
});
