// Garmin official export can contain a CURRENT FTP snapshot but not necessarily
// an effective date or a history of changes. Never infer old thresholds from it.
import {openPrivateGarminArchive} from './garmin-history-import.js';
import {zipEntries,unzipEntry} from './garmin-original-zip.js';
const SOURCES=[
 /^DI_CONNECT\/DI-Connect-Wellness\/[^/]+_powerZones\.json$/i,
 /^DI_CONNECT\/DI-Connect-Wellness\/[^/]+_userBioMetricProfileData\.json$/i
];
export function extractFtpCandidates(rows){
 if(!Array.isArray(rows))throw new Error('Estructura Garmin inesperada.');
 const values=[];
 for(const item of rows){
  if(!item||typeof item!=='object'||Array.isArray(item))continue;
  const ftp=Number(item.functionalThresholdPower);
  if(!Number.isFinite(ftp)||ftp<50||ftp>900)continue;
  values.push(ftp);
 }
 return [...new Set(values)];
}
export async function readGarminExportFtp(client,ownerId,archiveId,{signal}={}){
 const {blob}=await openPrivateGarminArchive(client,ownerId,archiveId,{signal});
 const entries=(await zipEntries(blob)).filter(e=>SOURCES.some(r=>r.test(e.name)));
 if(entries.length>20)throw new Error('Hay demasiados archivos de umbrales en esta exportación.');
 const results=[];
 for(const entry of entries){
  if(signal?.aborted)throw new DOMException('Lectura detenida','AbortError');
  if(entry.size>1024*1024)throw new Error('Un archivo de umbrales es demasiado grande.');
  const bytes=await unzipEntry(blob,entry,1024*1024);
  const text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);
  const parsed=JSON.parse(text);
  if(!Array.isArray(parsed))continue;
  for(const ftp of extractFtpCandidates(parsed))results.push({source:entry.name.endsWith('powerZones.json')?'Zonas de potencia':'Perfil biométrico',ftp});
 }
 return results;
}
export function mountGarminFtpDiscovery({root,client,ownerId,archiveId}){
 const doc=root.ownerDocument,el=(tag,txt)=>{const n=doc.createElement(tag);if(txt!==undefined)n.textContent=txt;return n;};
 const section=el('section');section.className='garmin-ftp-discovery';
 const title=el('h4','Recuperar FTP registrado en Garmin');
 const text=el('p','Consulta los valores FTP que Garmin guardó en la exportación. Estos valores no llevan fecha de vigencia histórica y no se aplicarán automáticamente a entrenamientos anteriores.');
 const button=el('button','Consultar FTP del archivo original');button.type='button';button.className='button secondary';
 const status=el('p');status.setAttribute('role','status');status.setAttribute('aria-live','polite');
 section.append(title,text,button,status);root.append(section);let closed=false;
 button.addEventListener('click',async()=>{
  button.disabled=true;status.textContent='Consultando valores FTP originales…';
  try{
   const rows=await readGarminExportFtp(client,ownerId,archiveId);
   if(closed||!section.isConnected)return;
   status.textContent=rows.length?
    'Valores encontrados: '+rows.map(x=>x.source+': '+x.ftp+' W').join(' · ')+
    '. No hay fechas de vigencia. El entrenador puede registrar el FTP en Rendimiento con la fecha que se confirme; así se recalculará el TSS sin volver a leer los FIT.':
    'Estos archivos no contienen un FTP válido. Conservamos el original sin modificarlo.';
  }catch(error){if(!closed&&section.isConnected)status.textContent=error.message;}
  finally{button.disabled=false;}
 });
 return ()=>{closed=true;};
}
