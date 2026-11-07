import {recoverRecentFit} from './garmin-single-fit-recovery.js';
import {listOriginals,uploadOriginal} from './garmin-original-vault.js';
import {previewGarminHistory,saveGarminHistory} from './garmin-history-import.js';
import {buildFullCatalog} from './garmin-full-catalog.js';
import {processGarminFitArchive} from './garmin-fit-analysis-runner.js';

// One explicit operation: original -> summaries -> index -> sports series.
// Each underlying stage retains its existing consent, RLS and resume safeguards.
export async function prepareCalendarHistory(client,ownerId,{file=null,archiveId=null,consent=false,signal,onProgress=()=>{}}={}){
 if(consent!==true)throw new Error('Confirma la autorización antes de importar el historial.');
 const stop=()=>{if(signal?.aborted)throw new DOMException('Importación detenida','AbortError');};
 stop();
 if(file){onProgress('Guardando tu exportación privada…');const saved=await uploadOriginal(client,ownerId,file,{signal,onProgress:v=>onProgress('Guardando exportación: '+Math.round(v.done/v.total*100)+' %.')});archiveId=saved.archive_id;}
 if(!archiveId)throw new Error('Selecciona una exportación de Garmin.');
 stop();onProgress('Preparando las actividades del calendario…');
 const preview=await previewGarminHistory(client,ownerId,archiveId,{signal});
 const summaries=preview.rows.length?await saveGarminHistory(client,ownerId,preview.rows,{signal,onProgress:v=>onProgress('Preparando actividades: '+v.done+' de '+v.total+'.')}):{imported:0,existing:0,total:0};
 stop();onProgress('Localizando los datos detallados…');
 try{await buildFullCatalog(client,ownerId,archiveId,{signal,onProgress:v=>{if(v.stage==='indexing')onProgress('Preparando detalles: '+v.done+' de '+v.total+' paquetes.');}});}
 catch(error){
  // Summary-only exports remain useful in the calendar; no fictitious curves.
  if(error.message==='Este ZIP no contiene paquetes Garmin con FIT, TCX o GPX.')return {...summaries,summaryOnly:true};
  throw error;
 }
 stop();const detail=await processGarminFitArchive(client,ownerId,archiveId,{signal,includeDetails:true,onProgress:v=>onProgress('Preparando curvas: '+v.done.toLocaleString('es-ES')+' de '+v.total.toLocaleString('es-ES')+' registros de archivo revisados. Mantén abierta la aplicación.')});
 return {...summaries,detail,summaryOnly:false};
}

export function mountHistoryHub({root,client,user,onCalendar}){
 const doc=root.ownerDocument,el=(tag,text,cls)=>{const n=doc.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;};
 const section=el('section',undefined,'garmin-settings-card');section.append(el('h3','Historial de actividades'));
 const status=el('p','Consultando el historial…','garmin-note');status.setAttribute('role','status');status.setAttribute('aria-live','polite');
 const calendar=el('button','Ver actividades en Calendario','button primary');calendar.type='button';calendar.addEventListener('click',()=>onCalendar?.());
 section.append(status,calendar);
 const details=el('details',undefined,'garmin-settings-details');details.append(el('summary','Importar historial'));
 details.append(el('p','Importa la exportación oficial de Garmin. Las actividades se consultan desde Calendario; aquí solo se prepara su incorporación. El original queda privado y se conserva íntegro.'));
 const input=el('input');input.type='file';input.accept='.zip,application/zip';input.setAttribute('aria-label','Exportación de Garmin');
 const selected=el('p','','ap-muted'),consent=el('label',undefined,'garmin-optin'),check=el('input');check.type='checkbox';
 consent.append(check,el('span','Autorizo guardar mi exportación completa de Garmin, incluidos los datos personales, fisiológicos y de ubicación que contenga, e incorporar sus actividades y series deportivas. Los resúmenes serán visibles para mis entrenadores vinculados; las curvas solo para los que autorice. El archivo completo y el GPS permanecen privados.'));
 const start=el('button','Preparar historial guardado','button primary');start.type='button';start.disabled=true;
 const cancel=el('button','Detener','button secondary');cancel.type='button';cancel.hidden=true;
 const progress=el('p','','garmin-note');progress.setAttribute('role','status');progress.setAttribute('aria-live','polite');
 details.append(selected,input,consent,start,cancel,progress);section.append(details);
 const repair=el('details',undefined,'garmin-settings-details');repair.append(el('summary','Completar actividad reciente desde un FIT'));
 repair.append(el('p','Si Garmin solo entregó el resumen, exporta el FIT original de esa actividad en Garmin Connect y selecciónalo aquí. Se cotejan deporte, fecha y duración con una única sesión existente. No se crea otra actividad ni se sustituyen los originales. Esta recuperación manual no equivale todavía a la descarga automática de Garmin.'));
 const fitInput=el('input');fitInput.type='file';fitInput.accept='.fit,application/octet-stream';fitInput.setAttribute('aria-label','FIT original de la actividad reciente');
 const fitConsent=el('label',undefined,'garmin-optin'),fitCheck=el('input');fitCheck.type='checkbox';
 fitConsent.append(fitCheck,el('span','Autorizo guardar en mi cuenta privada el archivo FIT íntegro, incluidos sus datos fisiológicos y de ubicación, y compartir las series deportivas derivadas únicamente con los entrenadores a los que ya haya concedido este permiso.'));
 const fitStart=el('button','Recuperar curvas de esta actividad','button primary');fitStart.type='button';fitStart.disabled=true;
 const fitCancel=el('button','Detener recuperación','button secondary');fitCancel.type='button';fitCancel.hidden=true;
 const fitStatus=el('p','','garmin-note');fitStatus.setAttribute('role','status');fitStatus.setAttribute('aria-live','polite');
 repair.append(fitInput,fitConsent,fitStart,fitCancel,fitStatus);section.append(repair);root.append(section);
 let fitBusy=false,fitController=null,fitClosed=false;
 const fitLock=()=>{fitInput.disabled=fitCheck.disabled=fitBusy;fitStart.disabled=fitBusy||!fitCheck.checked||!fitInput.files?.length;fitCancel.hidden=!fitBusy;};
 fitInput.addEventListener('change',()=>{fitCheck.checked=false;fitStatus.textContent=fitInput.files?.[0]?.name||'';fitLock();});
 fitCheck.addEventListener('change',fitLock);
 fitCancel.addEventListener('click',()=>{fitController?.abort();fitCancel.disabled=true;});
 fitStart.addEventListener('click',async()=>{
  if(fitBusy||!fitCheck.checked||!fitInput.files?.[0])return;
  fitBusy=true;fitController=new AbortController();fitCancel.disabled=false;fitLock();
  try{
   const result=await recoverRecentFit(client,user.id,fitInput.files[0],{consent:true,signal:fitController.signal,onProgress:value=>{if(!fitClosed&&section.isConnected)fitStatus.textContent=value;}});
   if(!fitClosed&&section.isConnected){
    fitStatus.textContent='Curvas recuperadas para «'+result.activity.title+'» ('+result.records+' registros). Abre la actividad en Calendario para consultar sus datos.';
    fitInput.value='';fitCheck.checked=false;await refresh();
   }
  }catch(error){if(!fitClosed&&section.isConnected)fitStatus.textContent=error.name==='AbortError'?'Recuperación detenida; los archivos ya conservados permanecen intactos.':error.message;}
  finally{fitBusy=false;fitController=null;if(!fitClosed&&section.isConnected)fitLock();}
 });

 let archive=null,file=null,busy=false,closed=false,controller=null;
 const live=()=>!closed&&section.isConnected;
 const lock=()=>{section.dataset.garminImportRunning=String(busy);input.disabled=check.disabled=busy;start.disabled=busy||!check.checked||(!file&&!archive);cancel.hidden=!busy;};
 async function refresh(){
  try{
   const [originals,count]=await Promise.all([listOriginals(client,user.id),client.from('activities').select('id',{count:'exact',head:true}).eq('athlete_id',user.id)]);
   if(!live())return;
   archive=originals.filter(x=>x.status==='ready'&&/\.zip$/i.test(x.filename)).sort((a,b)=>b.byte_size-a.byte_size)[0]||null;
   if(count.error)throw new Error('No se ha podido consultar el historial.');
   status.textContent=(count.count||0).toLocaleString('es-ES')+' actividades en tu calendario. Pulsa una actividad para ver sus datos y gráficas.';
   selected.textContent=archive?'Ya tienes una exportación guardada. Puedes continuar su preparación sin volver a subirla.':'Selecciona el ZIP de la exportación oficial de Garmin.';
   start.textContent=file?'Importar actividades':archive?'Preparar historial guardado':'Importar actividades';lock();
  }catch{if(live())status.textContent='No se ha podido comprobar el historial. Vuelve a abrir Garmin para intentarlo de nuevo.';}
 }
 input.addEventListener('change',()=>{file=input.files?.[0]||null;check.checked=false;selected.textContent=file?file.name+' · Se conservará una copia privada.':archive?'Se utilizará tu exportación guardada.':'Selecciona una exportación.';start.textContent=file?'Importar actividades':'Preparar historial guardado';lock();});
 check.addEventListener('change',lock);cancel.addEventListener('click',()=>{controller?.abort();cancel.disabled=true;});
 start.addEventListener('click',async()=>{
  if(busy||!check.checked||(!file&&!archive))return;busy=true;controller=new AbortController();cancel.disabled=false;lock();
  try{
   const result=await prepareCalendarHistory(client,user.id,{file,archiveId:archive?.archive_id,consent:check.checked,signal:controller.signal,onProgress:text=>{if(live())progress.textContent=text;}});
   if(live()){progress.textContent=result.summaryOnly?'Actividades incorporadas al calendario. Esta exportación contiene resúmenes, sin curvas detalladas.':'Preparación terminada. Abre Calendario y pulsa una actividad para consultar sus datos. Los casos que necesiten revisión están en Opciones avanzadas.';file=null;input.value='';check.checked=false;await refresh();}
  }catch(error){if(live())progress.textContent=error.name==='AbortError'?'Importación detenida. El avance guardado se conserva; puedes continuar más tarde.':error.message;}
  finally{busy=false;controller=null;if(live())lock();}
 });
 void refresh();return ()=>{closed=true;fitClosed=true;controller?.abort();fitController?.abort();};
}
