import {RECORD_DURATIONS} from './effort-records.js';
import {requirePerformanceSession} from './performance-data.js';
import {mountActivityDetail} from './activity-detail.js';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const date=v=>new Intl.DateTimeFormat('es-ES',{day:'2-digit',month:'short',year:'numeric',timeZone:'Europe/Madrid'}).format(new Date(v));
const environmentName={indoor:'Rodillo',outdoor:'Exterior',unknown:'Sin clasificar'};
const durationName=s=>s===3600?'1 hora':(s/60)+' min';

export async function loadEffortRecords(client,uid,sport){
 await requirePerformanceSession(client,uid);
 const r=await client.rpc('my_effort_records',{p_sport:sport});
 if(r.error||!r.data)throw Error('No se pudieron consultar los récords. Vuelve a intentarlo.');
 return r.data;
}
export async function requestEffortCalculation(client,uid,retry=false){
 await requirePerformanceSession(client,uid);
 const r=await client.functions.invoke('athlete-records',{body:{action:'start',retry}});
 if(r.error||r.data?.accepted!==true)throw Error('No se pudo iniciar la revisión. Pulsa Actualizar para volver a intentarlo.');
}
export function mountEffortRecords({root,client,user,kind}){
 const power=kind==='power',metric=power?'power':'heartRate',unit=power?'W':'ppm';
 let disposed=false,busy=false,sport='cycling',environment='all',data=null,lastStarted=0,detailDispose=null;
 const valid=()=>!disposed&&root.isConnected;
 root.innerHTML=`<section class="panel effort-records">
  <div class="effort-heading"><div><span class="eyebrow">HISTORIAL PERSONAL</span><h2>${power?'Mis récords de potencia':'Mis récords de pulso'}</h2></div><span class="effort-unit">${unit}</span></div>
  <p class="hub-hint">${power?'Las cinco mejores potencias medias de actividades diferentes para cada duración. Se incluyen los ceros de potencia.':'Las cinco mayores frecuencias cardíacas medias de actividades diferentes para cada duración.'}</p>
  <div class="effort-controls">
   <label>Comparar actividades<select data-effort-sport><option value="cycling">Ciclismo</option><option value="all">Todos los deportes</option><option value="running">Carrera</option><option value="strength">Fuerza</option><option value="swimming">Natación</option><option value="walking">Caminar</option><option value="other">Otros</option></select></label>
   ${power?'<label>Tipo de ciclismo<select data-effort-environment><option value="all">Todas</option><option value="indoor">Rodillo · indoor</option><option value="outdoor">Exterior</option><option value="unknown">Sin clasificar</option></select></label>':''}
   <button type="button" class="hub-link" data-effort-refresh>Actualizar</button>
  </div>
  ${power?'<p class="effort-filter-note">Rodillo y exterior tienen clasificaciones independientes. Si el FIT no permite distinguirlos con seguridad, la actividad queda «Sin clasificar»; no se supone que sea exterior.</p>':''}
  <p data-effort-status role="status" aria-live="polite">Consultando tu historial…</p>
  <div data-effort-table></div>
  <p class="effort-method">Medias de muestras consecutivas de 1 segundo. Los huecos, pausas y sensores ausentes cortan el tramo. No se interpolan registros ni se recalculan vatios con el FTP. El medidor y el rodillo pueden registrar potencias distintas: comprueba el sensor de origen antes de comparar.</p>
  <button type="button" class="hub-link" data-effort-retry hidden>Reintentar actividades pendientes de revisión</button>
  <p data-effort-error role="status"></p><div data-effort-detail></div>
 </section>`;
 const status=root.querySelector('[data-effort-status]'),error=root.querySelector('[data-effort-error]'),button=root.querySelector('[data-effort-refresh]');
 const topFor=seconds=>(data?.records||[]).filter(r=>r.metric===metric&&Number(r.seconds)===seconds&&
  (environment==='all'?Number(r.rank)<=5:r.environment===environment&&Number(r.environment_rank)<=5))
  .sort((a,b)=>Number(environment==='all'?a.rank:a.environment_rank)-Number(environment==='all'?b.rank:b.environment_rank)).slice(0,5);
 function draw(){
  if(!data)return;
  const withSeries=Number(data.with_series)||0,analysed=Number(data.analysed)||0;
  const current=Number(data.current_analysed??data.analysed)||0,failed=Number(data.failed)||0;
  const pending=Math.max(0,withSeries-current);
  status.textContent=pending?`Récords revisados con la clasificación actual: ${current} de ${withSeries} actividades. La lista puede cambiar mientras se revisa el historial.`:`${analysed} ${analysed===1?'actividad':'actividades'} con series revisadas.`;
  if(Number(data.total_activities)>withSeries){const missing=Number(data.total_activities)-withSeries;status.textContent+=` ${missing} ${missing===1?'actividad':'actividades'} aún no tienen series detalladas.`;}
  if(Number(data.without_samples))status.textContent+=` ${data.without_samples} carecen de muestras por segundo.`;
  if(failed)status.textContent+=` ${failed} requieren reintentar la lectura.`;
  root.querySelector('[data-effort-retry]').hidden=!failed;
  const table=`<table class="effort-table"><caption class="sr-only">${power?'Top 5 de potencia media':'Top 5 de pulso medio'} por duración</caption>
   <thead><tr><th scope="col">Tiempo</th><th scope="col">Cinco mejores registros</th></tr></thead>
   <tbody>${RECORD_DURATIONS.map(seconds=>{
    const selected=topFor(seconds);
    const ranking=selected.length?`<ol class="effort-top-list">${selected.map((r,i)=>`<li><span class="effort-rank" aria-label="Puesto ${i+1}">${i+1}.</span><div class="effort-result">
      <strong>${Number(r.mean).toLocaleString('es-ES',{maximumFractionDigits:1})} <span>${unit}</span></strong>
      <small>${esc(date(r.start_at))} <span class="effort-tag effort-tag-${esc(r.environment||'unknown')}">${esc(environmentName[r.environment]||environmentName.unknown)}</span></small>
      <button type="button" class="effort-activity" data-effort-activity="${esc(r.activity_id)}" aria-label="Abrir actividad ${esc(r.title)}">${esc(r.title)} <span aria-hidden="true">↗</span></button>
     </div></li>`).join('')}</ol>`:`<small class="effort-absent">${pending?'Aún revisando actividades de esta categoría':'Sin tramo completo registrado en esta categoría'}</small>`;
    return `<tr><th scope="row">${durationName(seconds)}</th><td>${ranking}</td></tr>`;
   }).join('')}</tbody></table>`;
  root.querySelector('[data-effort-table]').innerHTML=table;
 }
 async function start(retry=false){
  lastStarted=Date.now();
  try{await requestEffortCalculation(client,user.id,retry);if(valid()){error.textContent='';if(retry)status.textContent='Revisión en marcha. Se reanuda sin volver a cargar el historial.';}}
  catch(e){if(valid())error.textContent=e.message;}
 }
 async function refresh(){
  if(!valid()||busy)return;
  busy=true;button.disabled=true;const requestedSport=sport;
  try{
   const next=await loadEffortRecords(client,user.id,requestedSport);if(!valid())return;if(sport!==requestedSport)return;
   data=next;error.textContent='';draw();
   if(Number(data.with_series)>Number(data.current_analysed??data.analysed)&&Date.now()-lastStarted>120000)void start();
  }catch(e){if(valid())error.textContent=e.message;}
  finally{busy=false;button.disabled=false;if(valid()&&requestedSport!==sport)void refresh();}
 }
 function clearDetail(){detailDispose?.();detailDispose=null;root.querySelector('[data-effort-detail]').replaceChildren();}
 const sportChange=e=>{sport=e.target.value;data=null;status.textContent='Consultando tu historial…';root.querySelector('[data-effort-table]').replaceChildren();clearDetail();void refresh();};
 root.querySelector('[data-effort-sport]').addEventListener('change',sportChange);
 root.querySelector('[data-effort-environment]')?.addEventListener('change',e=>{environment=e.target.value;clearDetail();draw();});
 button.onclick=()=>void refresh();
 root.querySelector('[data-effort-retry]').onclick=async e=>{const retryButton=e.currentTarget;retryButton.disabled=true;await start(true);if(valid()){retryButton.disabled=false;await refresh();}};
 const click=e=>{
  const id=e.target.closest('[data-effort-activity]')?.dataset.effortActivity;if(!id)return;
  if(!(data?.records||[]).some(r=>r.activity_id===id&&r.metric===metric))return;
  const host=root.querySelector('[data-effort-detail]');clearDetail();
  host.innerHTML='<div class="effort-detail-heading"><h3>Actividad del récord</h3><button type="button" class="hub-link" data-effort-close>Cerrar actividad ×</button></div><div data-effort-viewer></div>';
  detailDispose=mountActivityDetail({root:host.querySelector('[data-effort-viewer]'),client,userId:user.id,activityId:id});
  host.querySelector('[data-effort-close]').onclick=clearDetail;host.scrollIntoView?.({block:'start',behavior:'auto'});
 };
 root.addEventListener('click',click);void refresh();
 const timer=globalThis.setInterval(()=>{
  if(!valid()){globalThis.clearInterval(timer);return;}
  if(root.ownerDocument.visibilityState==='visible'&&(!data||Number(data.current_analysed??data.analysed)<Number(data.with_series)))void refresh();
 },5000);timer.unref?.();
 return ()=>{disposed=true;globalThis.clearInterval(timer);clearDetail();root.removeEventListener('click',click);};
}
