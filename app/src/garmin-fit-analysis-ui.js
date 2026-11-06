import {processGarminFitArchive,readAnalysisSummary} from './garmin-fit-analysis-runner.js';
import {partialLoadCurve} from './garmin-fit-analysis.js';

// The owner explicitly initiates all scans. No source FIT or GPS is published,
// no background processing is represented as completed.
export function mountGarminFitAnalysis({root,client,ownerId,archiveId}){
 const doc=root.ownerDocument,el=(tag,text,cls)=>{
  const n=doc.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;
 };
 const container=el('section',undefined,'garmin-fit-analysis');
 const title=el('h4','Completar historial: series deportivas y diagnóstico');
 const intro=el('p','Revisa los FIT originales, conserva las series deportivas y vueltas para el análisis por actividad y registra el motivo de los descartes. Esta revisión amplía el análisis anterior: necesita recorrer de nuevo los paquetes una vez. Puedes detenerla y continuar sin repetir los paquetes completados.');
 const consent=el('label',undefined,'garmin-optin'),check=el('input');check.type='checkbox';
 consent.append(check,el('span','Autorizo analizar mis archivos deportivos y guardar sus curvas, vueltas y registros deportivos en mi cuenta. Se compartirán solo con los entrenadores para los que haya autorizado las series. Mi ZIP original y mis rutas GPS permanecen privados.'));
 const start=el('button','Completar series y revisar historial','button primary'),cancel=el('button','Detener análisis','button secondary');
 start.type=cancel.type='button';start.disabled=true;cancel.hidden=true;
 const status=el('p','','garmin-note');status.setAttribute('role','status');status.setAttribute('aria-live','polite');
 const results=el('div');container.append(title,intro,consent,start,cancel,status,results);root.append(container);
 let busy=false,closed=false,controller=null;
 const alive=()=>!closed&&container.isConnected;
 const unlock=()=>{busy=false;controller=null;if(alive()){start.disabled=!check.checked;check.disabled=false;cancel.hidden=true;cancel.disabled=false;}};
 function round(n){return typeof n==='number'&&Number.isFinite(n)?n.toLocaleString('es-ES',{maximumFractionDigits:2}):'—';}
 async function reload(){
  try{
   const summary=await readAnalysisSummary(client,ownerId,archiveId,{includeDetails:true});
   if(!alive())return;
   results.replaceChildren();
   const linked=summary.analysis.length,withNp=summary.analysis.filter(x=>x.normalized_power_watts!==null).length;
   const withTss=summary.analysis.filter(x=>x.tss!==null).length;
   results.append(el('p','Actividades vinculadas a su FIT: '+linked+'. Con NP calculada: '+withNp+'. Con TSS calculado: '+withTss+'.'));
   results.append(el('p','Actividades con series deportivas completas preparadas: '+(summary.series||[]).length+'.'));
   const reasons={};for(const d of summary.diagnostics||[])reasons[d.reason]=(reasons[d.reason]||0)+1;
   const labels={series_saved:'Serie deportiva guardada',linked:'Vinculada',already_linked:'Ya vinculada',not_activity:'FIT de otra categoría',multi_session:'Varias sesiones: revisar',few_records:'Sin registros de muestras',invalid_session:'Sesión sin datos suficientes',unsupported_sport:'Deporte no reconocido',no_match:'Sin coincidencia demostrable',ambiguous_match:'Varias actividades candidatas',unreadable:'Archivo ilegible',size_limit:'Tamaño fuera de límite'};
   const ulReasons=el('ul');for(const [key,count] of Object.entries(reasons))ulReasons.append(el('li',(labels[key]||key)+': '+count));results.append(ulReasons);
   const pending=(summary.diagnostics||[]).filter(d=>!['series_saved','linked','already_linked','not_activity'].includes(d.reason));
   if(pending.length){
    const review=el('details'),heading=el('summary','Revisar archivos pendientes ('+pending.length+')'),list=el('div');review.append(heading,list);results.append(review);let page=0;
    function show(){list.replaceChildren();const ul=el('ul');for(const d of pending.slice(page*40,(page+1)*40))ul.append(el('li',(labels[d.reason]||d.reason)+' · '+d.file_name+' · '+d.pack_name));list.append(ul);
     for(const [label,step] of [['Anterior',-1],['Siguiente',1]]){const b=el('button',label,'button secondary');b.type='button';b.disabled=page+step<0||(page+step)*40>=pending.length;b.addEventListener('click',()=>{page+=step;show();});list.append(b);}}
    show();
   }
   if(withNp&&!withTss)results.append(el('p','Sin FTP histórico válido: NP puede existir, pero el TSS no se inventa. El entrenador puede registrar umbrales en Rendimiento.'));
   if(linked){
    const ul=el('ul');
    for(const item of summary.analysis.slice(0,5)){
     const li=el('li',new Date(item.fit_started_at).toLocaleDateString('es-ES')+
      ' · '+item.sport+' · NP: '+(item.normalized_power_watts===null?'No calculable':round(Number(item.normalized_power_watts))+' W')+
      ' · TSS: '+(item.tss===null?'Sin FTP suficiente':round(Number(item.tss))));
     ul.append(li);
    }
    results.append(el('p','Últimas actividades analizadas:'),ul);
   }
   // CTL/ATL/TSB derived from this incomplete subset cannot be advertised as
   // real fatigue; show only clearly-labeled partial values when any TSS exists.
   if(withTss){
    const weighted=summary.analysis.filter(x=>x.tss!==null).sort((a,b)=>a.fit_started_at.localeCompare(b.fit_started_at));
    const last=weighted.at(-1).fit_started_at.slice(0,10);
    const firstDate=new Date(last+'T12:00:00Z');firstDate.setUTCDate(firstDate.getUTCDate()-179);
    const first=firstDate.toISOString().slice(0,10);
    const curve=partialLoadCurve(weighted,{from:first,to:last});
    const end=curve.at(-1);
    if(end)results.append(el('p','Proyección PARCIAL de los últimos 180 días, solo con TSS conocido (iniciada en cero): CTL '+
     round(end.partial_ctl)+' · ATL '+round(end.partial_atl)+' · TSB '+round(end.partial_tsb)+
     '. No mide la fatiga real si faltan sesiones, FTP históricos o datos de otros deportes.'));
   }
  }catch{if(alive())results.append(el('p','No se pudo consultar el análisis guardado.'));}
 }
 check.addEventListener('change',()=>{start.disabled=busy||!check.checked;});
 cancel.addEventListener('click',()=>{controller?.abort();cancel.disabled=true;});
 start.addEventListener('click',async()=>{
  if(busy||!check.checked)return;
  busy=true;check.disabled=true;start.disabled=true;cancel.hidden=false;controller=new AbortController();
  status.textContent='Preparando el análisis FIT privado. Mantén abierta esta pestaña.';
  try{
   const finished=await processGarminFitArchive(client,ownerId,archiveId,{
    signal:controller.signal,includeDetails:true,onProgress:v=>{
     if(!alive())return;
     status.textContent='Paquete '+v.pack+'/'+v.packages+' · FIT examinados: '+
      round(v.done)+'/'+round(v.total)+' · Nuevas actividades vinculadas: '+round(v.linked)+
      ' · Series nuevas: '+round(v.seriesSaved||0)+' · NP nuevas: '+round(v.withNp)+'.';
    }
   });
   if(alive()){
    status.textContent='Examen terminado: '+round(finished.scanned)+' de '+round(finished.total)+
     ' FIT examinados, '+round(finished.newLinks)+' nuevas vinculaciones. '+(finished.missingFtp?
     'Faltan los FTP históricos para calcular TSS.':'NP y TSS se calculan solo cuando los registros son suficientes.');
    await reload();
   }
  }catch(error){
   if(alive()){
    status.textContent=error.name==='AbortError'?'Análisis detenido. El avance guardado se conserva; puedes reanudar cuando quieras.':error.message;
    await reload();
   }
  }finally{unlock();}
 });
 void reload();
 return ()=>{closed=true;controller?.abort();};
}
