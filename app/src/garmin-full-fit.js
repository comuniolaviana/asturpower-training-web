import {Decoder,Stream} from '@garmin/fitsdk';
// The original is the source of truth. No message/field whitelist or averaging.
export function decodeCompleteFit(bytes){
 if(!(bytes instanceof Uint8Array)||bytes.length>50*1024*1024)
  throw new Error('Este FIT requiere un análisis de mayor tamaño. Su original se conserva completo.');
 const decoder=new Decoder(Stream.fromArrayBuffer(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength)));
 if(!decoder.isFIT()||!decoder.checkIntegrity())throw new Error('El FIT no supera la comprobación de integridad. Conserva el original para revisarlo.');
 const {messages,errors,profileVersion}=decoder.read({includeUnknownData:true,mergeHeartRates:false,decodeMemoGlobs:true});
 if(errors.length)throw new Error('El lector no pudo interpretar todos los mensajes. El original sigue disponible sin cambios.');
 return {messages,profileVersion,counts:Object.fromEntries(Object.entries(messages).map(([type,rows])=>[type,rows.length]))};
}
export function readableFitValue(value){
 return JSON.stringify(value,(_key,item)=>typeof item==='bigint'?item.toString():item,2);
}
