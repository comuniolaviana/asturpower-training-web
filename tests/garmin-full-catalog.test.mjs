import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {deflateRawSync} from 'node:zlib';
import {crc32} from '../app/src/garmin-original-zip.js';
import {originalIdentity} from '../app/src/garmin-original-vault.js';
import {buildFullCatalog,loadFullCatalog,readFullCatalogFile,fileKind} from '../app/src/garmin-full-catalog.js';

const OWNER='22222222-2222-4222-8222-222222222222';
function zip(name,raw,{compressed=true}={}){
 const nameBytes=new TextEncoder().encode(name),data=compressed?new Uint8Array(deflateRawSync(raw)):raw;
 const local=30+nameBytes.length+data.length,cd=46+nameBytes.length;
 const result=new Uint8Array(local+cd+22),v=new DataView(result.buffer);
 v.setUint32(0,0x04034b50,true);v.setUint16(4,20,true);v.setUint16(8,compressed?8:0,true);
 v.setUint32(14,crc32(raw),true);v.setUint32(18,data.length,true);v.setUint32(22,raw.length,true);
 v.setUint16(26,nameBytes.length,true);result.set(nameBytes,30);result.set(data,30+nameBytes.length);
 v.setUint32(local,0x02014b50,true);v.setUint16(local+10,compressed?8:0,true);
 v.setUint32(local+16,crc32(raw),true);v.setUint32(local+20,data.length,true);
 v.setUint32(local+24,raw.length,true);v.setUint16(local+28,nameBytes.length,true);
 result.set(nameBytes,local+46);
 const end=local+cd;v.setUint32(end,0x06054b50,true);v.setUint16(end+8,1,true);v.setUint16(end+10,1,true);
 v.setUint32(end+12,cd,true);v.setUint32(end+16,local,true);return result;
}
async function fixture(){
 const fit=new Uint8Array([14,16,35,0,1,2,3,4,46,70,73,84,0,0,25]);
 const packed=zip('one.fit',fit);
 const original=zip('DI_CONNECT/DI-Connect-Uploaded-Files/UploadedFiles_0-_Part1.zip',packed);
 const part={size:original.length,sha256:createHash('sha256').update(original).digest('hex')};
 const id=await originalIdentity([part],original.length);
 const saved=new Map();let actor=OWNER,downloads=0,writes=0;
 const client={auth:{getUser:async()=>({data:{user:{id:actor}},error:null})},
  storage:{from(name){assert.equal(name,'garmin-originals');return {download:async()=>{
   downloads++;return {data:new Blob([original]),error:null};
  }};}},
  from(name){
   if(name==='garmin_original_archives'){
    const b={select(){return b;},eq(){return b;},single:async()=>({data:{archive_id:id,filename:'export.zip',byte_size:original.length,status:'ready',chunks:[part]},error:null})};
    return b;
   }
   assert.equal(name,'garmin_original_catalog');
   const q={filters:[],
    select(){return q;},eq(key,value){q.filters.push([key,value]);return q;},order(){return q;},limit(){return q;},
    single:async()=>({data:[...saved.values()].find(r=>q.filters.every(([k,v])=>r[k]===v))||null,error:null}),
    then(resolve){return Promise.resolve({data:[...saved.values()].filter(r=>q.filters.every(([k,v])=>r[k]===v)),error:null}).then(resolve);},
    async upsert(row){writes++;saved.set(row.pack_name,row);return {error:null};}
   };
   return q;
  }};
 return {client,id,saved,fit,setActor:value=>{actor=value;},get downloads(){return downloads;},get writes(){return writes;}};
}
test('catalogues original FIT files by metadata without duplicating or modifying the original bytes',async()=>{
 const f=await fixture();
 const result=await buildFullCatalog(f.client,OWNER,f.id);
 assert.equal(result.length,1);assert.equal(result[0].entries.length,1);
 assert.deepEqual(result[0].entries[0],{name:'one.fit',byte_size:f.fit.length,kind:'FIT'});
 assert.equal(f.writes,1);
 assert.deepEqual(await loadFullCatalog(f.client,OWNER,f.id),result);
 const fetched=await readFullCatalogFile(f.client,OWNER,f.id,result[0].pack_name,'one.fit');
 assert.deepEqual(new Uint8Array(await fetched.blob.arrayBuffer()),f.fit);
 await buildFullCatalog(f.client,OWNER,f.id);assert.equal(f.writes,1);
 assert.equal(fileKind('any.tcx'),'TCX');assert.equal(fileKind('any.gpx'),'GPX');
});
test('catalogue access is denied after session identity changes',async()=>{
 const f=await fixture();f.setActor('33333333-3333-4333-8333-333333333333');
 await assert.rejects(buildFullCatalog(f.client,OWNER,f.id),/Sesión modificada/);
 assert.equal(f.downloads,0);assert.equal(f.writes,0);
});
