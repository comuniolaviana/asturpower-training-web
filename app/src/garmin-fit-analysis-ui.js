import {processGarminFitArchive,readAnalysisSummary} from './garmin-fit-analysis-runner.js';
import {partialLoadCurve} from './garmin-fit-analysis.js';

// The owner explicitly initiates all scans. No source FIT or GPS is published,
// no background processing is represented as completed.
export function mountGarminFitAnalysis({root,client,ownerId,archiveId}){
 const doc=root.ownerDocument,el=(tag,text,cls)=>{
  const n=doc.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;
 };
 const container=el('section',undefined,'garmin-fit-analysis');
 const title=el('h4','Vincular automáticamente FIT con actividades');
 const intro=el('p','Analiza los FIT originales por paquetes y relaciona solo las actividades con fecha, deporte y duración compatibles. Los archivos dudosos no se vinculan. La operación se puede detener y reanudar.');
 const consent=el('label',undefined,'garmin-optin'),check=el('input');check.type='checkbox';
 consent.append(check,el('span','Autorizo analizar mis archivos FIT y conservar los resultados deportivos derivados de forma privada en mi cuenta. Los archivos originales no se comparten con el entrenador.'));
 const start=el('button','Analizar y relacionar archivos FIT','button primary'),cancel=el('button','Detener análisis','button secondary');
 start.type=cancel.type='button';start.disabled=true;cancel.hidden=true;
 const status=el('p','','garmin-note');status.setAttribute('role','status');status.setAttribute('aria-live','polite');
 const results=el('div');container.append(title,intro,consent,start,cancel,status,results);root.append(container);
 let busy=false,closed=false,controller=null;
 const alive=()=>!closed&&container.isConnected;
 const unlock=()=>{busy=false;controller=null;if(alive()){start.disabled=!check.checked;check.disabled=false;cancel.hidden=true;cancel.disabled=false;}};
 function round(n){return typeof n==='number'&&Number.isFinite(n)?n.toLocaleString('es-ES',{maximumFractionDigits:2}):'—';}
 async function reload(){
  try{
   const summary=await readAnalysisSummary(client,ownerId,archiveId);
   if(!alive())return;
   results.replaceChildren();
   const linked=summary.analysis.length,withNp=summary.analysis.filter(x=>x.normalized_power_watts!==null).length;
   const withTss=summary.analysis.filter(x=>x.tss!==null).length;
   results.append(el('p','Actividades vinculadas a su FIT: '+linked+'. Con NP calculada: '+withNp+'. Con TSS calculado: '+withTss+'.'));
   if(withNp&&!withTss)results.append(el('p','Sin FTP histórico válido: NP puede existir, pero el TSS no se inventa. El entrenador puede registrar umbrales en Rendimiento.'));
   if(linked){
    const ul=el('ul');
    for(const item of summary.analysis.slice(0,5)){
     const li=el('li',new Date(item.fit_started_at).toLocaleDateString('es-ES')+
      ' · '+item.sport+' · NP: '+round(Number(item.normalized_power_watts))+
      ' W · TSS: '+(item.tss===null?'Sin FTP suficiente':round(Number(item.tss))));
     ul.append(li);
    }
    results.append(el('p','Últimas actividades analizadas:'),ul);
   }
   // CTL/ATL/TSB derived from this incomplete subset cannot be advertised as
   // real fatigue; show only clearly-labeled partial values when any TSS exists.
   if(withTss){
    const weighted=summary.analysis.filter(x=>x.tss!==null).sort((a,b)=>a.fit_started_at.localeCompare(b.fit_started_at));
    const first=weighted[0].fit_started_at.slice(0,10),last=weighted.at(-1).fit_started_at.slice(0,10);
    const days=Math.min(366,Math.ceil((Date.parse(last)-Date.parse(first))/86400000)+1);
    if(days>=14&&days<=366){
     const curve=partialLoadCurve(weighted,{from:first,to:last});
     const end=curve.at(-1);
     if(end)results.append(el('p','Estimación PARCIAL solo con TSS conocido: CTL '+round(end.partial_ctl)+
      ' · ATL '+round(end.partial_atl)+' · TSB '+round(end.partial_tsb)+
      '. No representa la fatiga real si faltan sesiones, FTP históricos o datos de otros deportes.'));
    }
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
    signal:controller.signal,onProgress:v=>{
     if(!alive())return;
     status.textContent='Paquete '+v.pack+'/'+v.packages+' · FIT examinados: '+
      round(v.done)+'/'+round(v.total)+' · Nuevas actividades vinculadas: '+round(v.linked)+
      ' · NP: '+round(v.withNp)+' · TSS: '+round(v.withTss)+'.';
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
