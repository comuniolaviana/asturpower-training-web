// ZIP names remain data. No entry is extracted to a filesystem or executed.
const LIMIT=50*1024*1024;
const crcTable=Array.from({length:256},(_,n)=>{let v=n;for(let i=0;i<8;i++)v=v&1?0xedb88320^(v>>>1):v>>>1;return v>>>0;});
export function crc32(bytes){let c=0xffffffff;for(const b of bytes)c=crcTable[(c^b)&255]^(c>>>8);return(c^0xffffffff)>>>0;}
function fail(){throw new Error('El ZIP no se puede interpretar con seguridad. El original se conserva sin cambios.');}
function integer64(view,offset){const n=Number(view.getBigUint64(offset,true));if(!Number.isSafeInteger(n))fail();return n;}
export async function zipEntries(blob){
 const start=Math.max(0,blob.size-65557),tail=new Uint8Array(await blob.slice(start).arrayBuffer()),v=new DataView(tail.buffer);
 let e=-1;
 for(let i=tail.length-22;i>=0;i--)if(v.getUint32(i,true)===0x06054b50&&i+22+v.getUint16(i+20,true)===tail.length){e=i;break;}
 if(e<0||v.getUint16(e+4,true)||v.getUint16(e+6,true))fail();
 let count=v.getUint16(e+10,true),size=v.getUint32(e+12,true),offset=v.getUint32(e+16,true);
 if(count===65535||size===0xffffffff||offset===0xffffffff){
  if(e<20||v.getUint32(e-20,true)!==0x07064b50||v.getUint32(e-16,true)!==0||v.getUint32(e-4,true)!==1)fail();
  const at=integer64(v,e-12),z=new DataView(await blob.slice(at,at+56).arrayBuffer());
  if(z.byteLength!==56||z.getUint32(0,true)!==0x06064b50||z.getUint32(16,true)||z.getUint32(20,true))fail();
  count=integer64(z,32);size=integer64(z,40);offset=integer64(z,48);
 }else if(v.getUint16(e+8,true)!==count)fail();
 if(count>100000||size>32*1024*1024||offset+size>start+e)fail();
 const bytes=new Uint8Array(await blob.slice(offset,offset+size).arrayBuffer()),cd=new DataView(bytes.buffer),decode=new TextDecoder();
 const entries=[];let p=0;
 for(let i=0;i<count;i++){
  if(p+46>bytes.length||cd.getUint32(p,true)!==0x02014b50||cd.getUint16(p+34,true))fail();
  const nl=cd.getUint16(p+28,true),el=cd.getUint16(p+30,true),cl=cd.getUint16(p+32,true),end=p+46+nl+el+cl;
  if(end>bytes.length)fail();
  const name=decode.decode(bytes.subarray(p+46,p+46+nl));
  const entry={name,flags:cd.getUint16(p+8,true),method:cd.getUint16(p+10,true),crc:cd.getUint32(p+16,true),
   compressed:cd.getUint32(p+20,true),size:cd.getUint32(p+24,true),offset:cd.getUint32(p+42,true)};
  if([entry.compressed,entry.size,entry.offset].includes(0xffffffff)){
   let q=p+46+nl,found=false;
   while(q+4<=p+46+nl+el){
    const id=cd.getUint16(q,true),len=cd.getUint16(q+2,true);q+=4;if(q+len>p+46+nl+el)fail();
    if(id===1){let k=q;
     for(const key of ['size','compressed','offset'])if(entry[key]===0xffffffff){if(k+8>q+len)fail();entry[key]=integer64(cd,k);k+=8;}
     found=true;break;
    }q+=len;
   }if(!found)fail();
  }
  if(!name.endsWith('/'))entries.push(entry);p=end;
 }
 return entries;
}
export async function unzipEntry(blob,entry,maxBytes=LIMIT){
 if(entry.flags&1||entry.size>maxBytes||entry.compressed>maxBytes*2||![0,8].includes(entry.method))
  throw new Error('Esta entrada requiere otro método de lectura. Sus bytes siguen completos en el original.');
 const h=new DataView(await blob.slice(entry.offset,entry.offset+30).arrayBuffer());
 if(h.byteLength!==30||h.getUint32(0,true)!==0x04034b50||h.getUint16(8,true)!==entry.method||(h.getUint16(6,true)&1))fail();
 const at=entry.offset+30+h.getUint16(26,true)+h.getUint16(28,true);if(at+entry.compressed>blob.size)fail();
 const source=blob.slice(at,at+entry.compressed);
 let stream=source.stream();
 if(entry.method===8){
  let transform;try{transform=new DecompressionStream('deflate-raw');}catch{throw new Error('Este navegador no puede abrir esta compresión. Prueba en Chrome o Edge de ordenador.');}
  stream=stream.pipeThrough(transform);
 }
 // Stream both stored and deflated large members: a 50 MiB nested ZIP must
 // never require a single >32 MiB remote read or bypass integrity checks.
 const reader=stream.getReader(),parts=[];let size=0;
 try{for(;;){const r=await reader.read();if(r.done)break;size+=r.value.length;if(size>maxBytes)fail();parts.push(r.value);}}
 finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
 const output=new Uint8Array(size);let position=0;for(const part of parts){output.set(part,position);position+=part.length;}
 if(output.length!==entry.size||crc32(output)!==entry.crc)fail();return output;
}
