import {parseTrainingPeaksSummary,compareTrainingPeaks} from './trainingpeaks-audit.js';
import {loadCoachFitDetails} from './coach-fit-dashboard.js';
import {loadSourceLabel} from './garmin-fit-analysis.js';

const esc=v=>String(v??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const fmt=n=>n===null||n===undefined?'—':Number(n).toLocaleString('es-ES',{maximumFractionDigits:2});
const labels={missing:'Falta TSS Garmin',different:'Diferencia relevante',comparable:'Dentro del margen',ambiguous:'Coincidencia ambigua',unmatched:'Sin actividad Garmin',skipped:'Fila no utilizable'};

export function mountTrainingPeaksAudit({root,client,coachId,athletes=[],loader=loadCoachFitDetails}){
 let epoch=0,details=null;
 root.innerHTML='<section class="perf-card"><span class="eyebrow">CONTROL DE CALIDAD · SIN CAMBIAR DATOS</span>'+
  '<h3>Comparar con TrainingPeaks</h3>'+
  '<p>Comprueba qué cargas TSS faltan o difieren. El archivo CSV se lee <strong>únicamente en este navegador</strong>: no se envía ni se guarda en AsturPower y no altera los originales Garmin.</p>'+
  '<p>En TrainingPeaks: <strong>Configuración → Export Data → Workout Summary</strong>. Elige hasta 12 meses y descarga el archivo CSV.</p>'+
  '<div class="perf-fields"><label class="perf-field"><span>Deportista vinculado</span><select data-tp-athlete><option value="">Selecciona un deportista</option>'+
  athletes.map(a=>'<option value="'+esc(a.user_id)+'">'+esc(a.display_name)+'</option>').join('')+
  '</select></label><label class="perf-field"><span>CSV TrainingPeaks (máximo 4 MB)</span><input data-tp-file type="file" accept=".csv,text/csv" disabled></label></div>'+
  '<p data-tp-status role="status" aria-live="polite">Selecciona un deportista para comprobar permisos.</p><div data-tp-result></div>'+
  '<p class="perf-note">Solo se usa TssActual, nunca TssPlanned. El emparejamiento requiere misma fecha, deporte y duración cercana. Las coincidencias ambiguas quedan sin asociar. Una comparación favorable no certifica un historial completo.</p></section>';
 const $=s=>root.querySelector(s),athlete=$('[data-tp-athlete]'),file=$('[data-tp-file]'),status=$('[data-tp-status]'),view=$('[data-tp-result]');
 const clear=()=>{file.value='';file.disabled=true;view.replaceChildren();details=null;};
 athlete.addEventListener('change',async()=>{
  const ticket=++epoch,athleteId=athlete.value;clear();
  if(!athleteId){status.textContent='Selecciona un deportista.';return;}
  status.textContent='Comprobando vinculación y autorización de métricas deportivas…';
  try{
   const loaded=await loader(client,coachId,athleteId,{includeSeries:false});
   if(epoch!==ticket||!root.isConnected)return;
   if(!loaded.allowed){status.textContent='El deportista debe autorizar el acceso a sus métricas deportivas.';return;}
   details=loaded;file.disabled=false;
   status.textContent='Historial consultado: '+loaded.activities.length.toLocaleString('es-ES')+' actividades. Selecciona un CSV para comparar.';
  }catch{
   if(epoch===ticket&&root.isConnected)status.textContent='No se pudo acceder a los datos autorizados. Revisa la vinculación y vuelve a intentarlo.';
  }
 });
 file.addEventListener('change',async()=>{
  const ticket=++epoch,input=file.files?.[0];view.replaceChildren();
  if(!details||!input)return;
  if(input.size<=0||input.size>4*1024*1024||!/\.csv$/i.test(input.name)){
   status.textContent='Selecciona un archivo .csv válido, de hasta 4 MB.';file.value='';return;
  }
  const snapshot=details;
  status.textContent='Comparando localmente los entrenamientos…';file.disabled=true;
  try{
   const text=await input.text();
   if(ticket!==epoch||!root.isConnected)return;
   const parsed=parseTrainingPeaksSummary(text);
   const report=compareTrainingPeaks({...parsed,activities:snapshot.activities,metrics:snapshot.metrics});
   const c=report.counts,doc=root.ownerDocument;
   const summary=doc.createElement('p');summary.className='perf-note';
   summary.textContent=report.total+' filas · '+c.comparable+' coincidencias dentro del margen · '+c.different+
    ' diferencias · '+c.missing+' sin TSS Garmin · '+c.ambiguous+' ambiguas · '+c.unmatched+
    ' sin actividad Garmin · '+c.skipped+' no utilizables.';
   view.append(summary);
   const incidents=report.results.filter(e=>e.status!=='comparable');
   const visible=(incidents.length?incidents:report.results).slice(0,150);
   if(visible.length){
    const note=doc.createElement('p');note.className='perf-note';note.textContent='Detalle: '+visible.length+' de '+(incidents.length||report.results.length)+' filas ('+(incidents.length?'incidencias':'coincidencias')+').';view.append(note);
    const host=doc.createElement('div');host.className='perf-scroll';
    const table=doc.createElement('table');table.innerHTML='<thead><tr><th>Fecha</th><th>Deporte</th><th>Duración TP</th><th>TSS TP</th><th>Método TP</th><th>TSS AsturPower</th><th>Origen AsturPower</th><th>Resultado</th></tr></thead>';
    const body=doc.createElement('tbody');
    for(const e of visible){
     const row=doc.createElement('tr');
     const values=[e.date,e.sourceSport,e.seconds?fmt(e.seconds/60)+' min':'—',fmt(e.tss),e.method,
      fmt(e.garminTss),e.garminSource?loadSourceLabel(e.garminSource):'—',
      (labels[e.status]||e.status)+(e.reason?' · '+e.reason:'')+(e.difference!=null?' · Diferencia '+fmt(e.difference):'')];
     for(const value of values){const cell=doc.createElement('td');cell.textContent=value;row.append(cell);}
     body.append(row);
    }
    table.append(body);host.append(table);view.append(host);
   }
   status.textContent='Comparación terminada en este navegador. Ningún TSS se ha importado.';
  }catch(error){
   if(ticket===epoch&&root.isConnected)status.textContent='No se pudo comparar el CSV: '+String(error?.message||'Formato no reconocido').slice(0,180);
  }finally{if(ticket===epoch&&root.isConnected){file.value='';file.disabled=!details;}}
 });
 return ()=>{epoch++;clear();};
}
