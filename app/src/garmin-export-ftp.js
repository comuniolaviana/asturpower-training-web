// Garmin Connect export: FTP snapshots and historical configuration events.
// The original ZIP remains private and immutable; nothing is silently applied.
import {openPrivateGarminArchive} from './garmin-history-import.js';
import {zipEntries,unzipEntry} from './garmin-original-zip.js';
import {savePhysiology} from './performance-data.js';
const SOURCES=[
 /^DI_CONNECT\/DI-Connect-Wellness\/[^/]+_powerZones\.json$/i,
 /^DI_CONNECT\/DI-Connect-Wellness\/[^/]+_userBioMetricProfileData\.json$/i
];
const HISTORY=/^DI_CONNECT\/DI-Connect-Wellness\/[^/]+_userBioMetrics\.json$/i;
function validFtp(value){
 if(value===null||value===undefined||String(value).trim()==='')return null;
 const n=Number(value);return Number.isFinite(n)&&n>=50&&n<=900?n:null;
}
export function extractFtpCandidates(rows){
 if(!Array.isArray(rows))throw new Error('Estructura Garmin inesperada.');
 return [...new Set(rows.map(x=>x&&typeof x==='object'&&!Array.isArray(x)?validFtp(x.functionalThresholdPower):null).filter(x=>x!==null))];
}
export function extractFtpHistory(rows){
 if(!Array.isArray(rows)||rows.length>20000)throw new Error('Historial de biometría Garmin inesperado.');
 const samples=[];
 for(const row of rows){
  if(!row||typeof row!=='object'||Array.isArray(row))continue;
  const ftp=validFtp(row.functionalThresholdPower),dateTime=row.metaData?.calendarDate;
  if(ftp===null||typeof dateTime!=='string'||!/^20\d\d-\d\d-\d\dT/.test(dateTime))continue;
  const date=dateTime.slice(0,10);
  if(!Number.isFinite(Date.parse(date+'T12:00:00Z')))continue;
  const version=Number(row.version);
  if(!Number.isSafeInteger(version)||version<1e12||version>3e12)continue;
  samples.push({date,ftp,version});
 }
 samples.sort((a,b)=>a.version-b.version);
 // A daily FTP calculation has no intraday granularity: choose latest Garmin
 // configuration of each day, and report any same-day conflicting values.
 const byDay=new Map(),conflicts=new Set();
 for(const s of samples){
  const prior=byDay.get(s.date);
  if(prior&&prior.ftp!==s.ftp)conflicts.add(s.date);
  byDay.set(s.date,s);
 }
 const dated=[...byDay.values()].sort((a,b)=>a.date.localeCompare(b.date)||a.version-b.version);
 const changes=[];
 for(const s of dated){
  if(!changes.length||changes.at(-1).ftp!==s.ftp)changes.push({effective_date:s.date,ftp:s.ftp});
 }
 return {changes,records:samples.length,conflicts:[...conflicts].sort()};
}
async function sourceData(blob,entry,max=2*1024*1024){
 if(entry.size>max)throw new Error('Un archivo biométrico de Garmin supera el límite de lectura segura.');
 const bytes=await unzipEntry(blob,entry,max);
 const decoded=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
 if(!Array.isArray(decoded))throw new Error('El archivo de FTP de Garmin tiene un formato inesperado.');
 return decoded;
}
export async function readGarminExportFtp(client,ownerId,archiveId,{signal}={}){
 const {blob}=await openPrivateGarminArchive(client,ownerId,archiveId,{signal});
 const entries=await zipEntries(blob),snapshotEntries=entries.filter(e=>SOURCES.some(r=>r.test(e.name)));
 if(snapshotEntries.length>20)throw new Error('Demasiados archivos de umbrales en la exportación.');
 const current=[];
 for(const entry of snapshotEntries){
  if(signal?.aborted)throw new DOMException('Lectura detenida','AbortError');
  for(const ftp of extractFtpCandidates(await sourceData(blob,entry)))
   current.push({source:entry.name.endsWith('powerZones.json')?'Zonas de potencia':'Perfil biométrico',ftp});
 }
 const histories=entries.filter(e=>HISTORY.test(e.name));
 if(histories.length>10)throw new Error('Hay demasiados historiales biométricos en el original.');
 let snapshots=[],conflicts=[],records=0;
 for(const entry of histories){
  if(signal?.aborted)throw new DOMException('Lectura detenida','AbortError');
  const result=extractFtpHistory(await sourceData(blob,entry));
  snapshots.push(...result.changes);conflicts.push(...result.conflicts);records+=result.records;
 }
 // Multiple historical files can overlap; preserve latest value per date.
 const history=extractFtpHistory(snapshots.map((x,i)=>({
  functionalThresholdPower:x.ftp,
  metaData:{calendarDate:x.effective_date+'T12:00:00'},
  version:Date.parse(x.effective_date+'T12:00:00Z')+i,
 }))).changes;
 return {current,history,records,conflicts:[...new Set(conflicts)]};
}
export async function saveConfirmedGarminFtpHistory(client,ownerId,history){
 if(!Array.isArray(history)||!history.length||history.length>100)throw new Error('Historial FTP no válido.');
 const auth=await client.auth.getUser();
 if(auth.error||auth.data?.user?.id!==ownerId)throw new Error('La sesión del deportista ha cambiado.');
 const existing=await client.from('athlete_physiology')
  .select('id,sport,effective_date,ftp,lthr,hr_max,hr_rest,weight_kg,threshold_pace_seconds,power_zone_bounds,hr_zone_bounds')
  .eq('athlete_id',ownerId).eq('sport','cycling').limit(501);
 if(existing.error||!Array.isArray(existing.data))throw new Error('No se pudo comprobar la ficha deportiva antes de guardar.');
 if(existing.data.length>500)throw new Error('El historial actual es demasiado grande para fusionar automáticamente.');
 if(existing.data.some(r=>r.lthr!==null||r.hr_max!==null||r.hr_rest!==null||r.weight_kg!==null||
  r.threshold_pace_seconds!==null||r.power_zone_bounds!==null||r.hr_zone_bounds!==null))
  throw new Error('La ficha ya contiene otros parámetros fisiológicos. Revisa la importación con tu entrenador para no sustituirlos.');
 const existingByDate=new Map(existing.data.map(r=>[r.effective_date,Number(r.ftp)]));
 let added=0,already=0;
 for(const item of history){
  const date=String(item.effective_date),ftp=validFtp(item.ftp);
  if(!/^20\d\d-\d\d-\d\d$/.test(date)||ftp===null)throw new Error('El histórico contiene una fecha o un FTP no válido.');
  if(existingByDate.has(date)){
   if(existingByDate.get(date)!==ftp)throw new Error('Existe otro FTP en la fecha '+date+'. Revisa ese conflicto con el entrenador.');
   already++;continue;
  }
  await savePhysiology(client,ownerId,ownerId,{sport:'cycling',effective_date:date,ftp});
  existingByDate.set(date,ftp);added++;
 }
 return {added,already};
}
export function mountGarminFtpDiscovery({root,client,ownerId,archiveId}){
 const doc=root.ownerDocument,el=(tag,txt)=>{const n=doc.createElement(tag);if(txt!==undefined)n.textContent=txt;return n;};
 const section=el('section');section.className='garmin-ftp-discovery';
 const title=el('h4','Recuperar FTP históricos registrados en Garmin');
 const text=el('p','El archivo Garmin contiene cambios de configuración del FTP con fechas. Revisa estos valores antes de incorporarlos a tu ficha; no son pruebas de FTP medidas ni justifican aplicar un único FTP a todo el historial.');
 const inspect=el('button','Consultar FTP del archivo original');inspect.type='button';inspect.className='button secondary';
 const status=el('p');status.setAttribute('role','status');status.setAttribute('aria-live','polite');
 const details=el('div');section.append(title,text,inspect,status,details);root.append(section);
 let closed=false,busy=false,preview=null;
 inspect.addEventListener('click',async()=>{
  if(busy)return;busy=true;inspect.disabled=true;details.replaceChildren();
  status.textContent='Consultando FTP y cambios históricos del original Garmin…';
  try{
   preview=await readGarminExportFtp(client,ownerId,archiveId);
   if(closed||!section.isConnected)return;
   status.textContent=preview.current.length?
    'FTP de perfil actual: '+[...new Set(preview.current.map(x=>x.ftp))].join(', ')+' W. '+
    'Registros históricos fechados: '+preview.records+'. Cambios detectados: '+preview.history.length+'.':
    'Registros históricos fechados: '+preview.records+'. Cambios detectados: '+preview.history.length+'.';
   if(preview.history.length){
    const heading=el('p','Cambios históricos encontrados (fecha registrada por Garmin):');
    const ul=el('ul');
    for(const r of preview.history)ul.append(el('li',r.effective_date.split('-').reverse().join('/')+' · FTP '+r.ftp+' W'));
    details.append(heading,ul);
    if(preview.conflicts.length)details.append(el('p','Atención: hay cambios distintos dentro del mismo día ('+preview.conflicts.join(', ')+'). Para los cálculos diarios se propone el último valor guardado ese día.'));
    const opt=el('label'),checked=el('input');checked.type='checkbox';
    opt.append(checked,el('span','He revisado estos valores y autorizo incorporarlos como historial de FTP de mi cuenta. Podré pedir a mi entrenador que corrija las fechas o los umbrales.'));
    const save=el('button','Guardar FTP históricos revisados');save.type='button';save.className='button primary';save.disabled=true;
    checked.addEventListener('change',()=>{save.disabled=!checked.checked||busy;});
    details.append(opt,save);
    save.addEventListener('click',async()=>{
     if(busy||!checked.checked||!preview)return;
     busy=true;save.disabled=true;checked.disabled=true;inspect.disabled=true;
     status.textContent='Guardando valores FTP confirmados, sin modificar los FIT originales…';
     try{
      const result=await saveConfirmedGarminFtpHistory(client,ownerId,preview.history);
      if(!closed&&section.isConnected)status.textContent='FTP históricos guardados: '+result.added+' nuevos, '+result.already+' ya existentes. El TSS podrá calcularse con los FTP vigentes según la fecha, sin repetir el escaneo FIT.';
     }catch(error){if(!closed&&section.isConnected){status.textContent=error.message;checked.disabled=false;save.disabled=false;}}
     finally{busy=false;inspect.disabled=false;}
    });
   }else details.append(el('p','No hay FTP históricos fechados en estos archivos.'));
  }catch(error){if(!closed&&section.isConnected)status.textContent=error.message;}
  finally{busy=false;inspect.disabled=false;}
 });
 return ()=>{closed=true;};
}
