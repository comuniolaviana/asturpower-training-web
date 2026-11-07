import {RECORD_DURATIONS} from './effort-records.js';
import {requirePerformanceSession} from './performance-data.js';
import {mountActivityDetail} from './activity-detail.js';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const date=v=>new Intl.DateTimeFormat('es-ES',{day:'2-digit',month:'short',year:'numeric',timeZone:'Europe/Madrid'}).format(new Date(v));
export async function loadEffortRecords(client,uid,sport){await requirePerformanceSession(client,uid);const r=await client.rpc('my_effort_records',{p_sport:sport});if(r.error||!r.data)throw Error('No se pudieron consultar los récords. Vuelve a intentarlo.');return r.data;}
export async function requestEffortCalculation(client,uid,retry=false){
 await requirePerformanceSession(client,uid);
 const r=await client.functions.invoke('athlete-records',{body:{action:'start',retry}});
 if(r.error||r.data?.accepted!==true)throw Error('No se pudo iniciar la revisión. Pulsa Actualizar para volver a intentarlo.');
}
export function mountEffortRecords({root,client,user,kind}){
 const power=kind==='power',metric=power?'power':'heartRate',unit=power?'W':'ppm';
 let disposed=false,busy=false,sport='cycling',data=null,lastStarted=0,detailDispose=null;
 const valid=()=>!disposed&&root.isConnected;
 root.innerHTML=`<section class="panel effort-records"><div class="effort-heading"><div><span class="eyebrow">HISTORIAL PERSONAL</span><h2>${power?'Mis récords de potencia':'Mis récords de pulso'}</h2></div><span class="effort-unit">${unit}</span></div><p class="hub-hint">${power?'Mayor potencia media sostenida en cada intervalo. Se incluyen los ceros de potencia.':'Mayor frecuencia cardíaca media registrada en cada intervalo. Estos valores describen tu historial.'}</p><div class="effort-controls"><label>Comparar actividades<select data-effort-sport><option value="cycling">Ciclismo</option><option value="all">Todos los deportes</option><option value="running">Carrera</option><option value="strength">Fuerza</option><option value="swimming">Natación</option><option value="walking">Caminar</option><option value="other">Otros</option></select></label><button type="button" class="hub-link" data-effort-refresh>Actualizar</button></div><p data-effort-status role="status" aria-live="polite">Consultando tu historial…</p><div data-effort-table></div><p class="effort-method">Medias de registros consecutivos de 1 segundo. Los huecos, las pausas y los sensores ausentes cortan el tramo; no se rellenan datos ni se convierten vatios en función del FTP. Son valores del sensor; puedes revisar el original si alguno parece anómalo.</p><button type="button" class="hub-link" data-effort-retry hidden>Reintentar actividades pendientes de revisión</button><p data-effort-error role="status"></p><div data-effort-detail></div></section>`;
 const status=root.querySelector('[data-effort-status]'),error=root.querySelector('[data-effort-error]'),button=root.querySelector('[data-effort-refresh]');
 function draw(){
  const pending=Math.max(0,Number(data.with_series)-Number(data.analysed)),failed=Number(data.failed)||0;
  status.textContent=pending?`Calculando historial: ${data.analysed} de ${data.with_series} actividades con series revisadas. Puedes cerrar la app; el cálculo continúa.`:`${data.analysed} actividades con series revisadas.`;
  if(Number(data.total_activities)>Number(data.with_series))status.textContent+=` ${data.total_activities-data.with_series} actividades aún no tienen series detalladas.`;
  if(Number(data.without_samples))status.textContent+=` ${data.without_samples} no contienen muestras por segundo.`;
  if(failed)status.textContent+=` ${failed} requieren reintentar la lectura.`;
  root.querySelector('[data-effort-retry]').hidden=!failed;
  const records=(data.records||[]).filter(r=>r.metric===metric);
  root.querySelector('[data-effort-table]').innerHTML=`<table class="effort-table"><caption class="sr-only">${power?'Potencia media máxima':'Pulso medio máximo'} por duración</caption><thead><tr><th scope="col">Tiempo</th><th scope="col">Mejor media</th><th scope="col">Actividad</th></tr></thead><tbody>${RECORD_DURATIONS.map(seconds=>{const r=records.find(r=>Number(r.seconds)===seconds);return `<tr><th scope="row">${seconds===3600?'1 hora':seconds/60+' min'}</th><td>${r?`<strong>${Number(r.mean).toLocaleString('es-ES',{maximumFractionDigits:1})} <span>${unit}</span></strong><small>${esc(date(r.start_at))}</small>`:'<span class="effort-absent">—</span>'}</td><td>${r?`<button type="button" class="effort-activity" data-effort-activity="${esc(r.activity_id)}" aria-label="Ver actividad del récord de ${seconds/60} minutos: ${esc(r.title)}">${esc(r.title)} <span aria-hidden="true">↗</span></button>`:`<small>${pending?'En revisión':'Sin tramo completo registrado'}</small>`}</td></tr>`;}).join('')}</tbody></table>`;
 }
 async function start(retry=false){lastStarted=Date.now();try{await requestEffortCalculation(client,user.id,retry);if(valid()){error.textContent='';if(retry)status.textContent='Revisión en marcha. Se reanuda sin volver a cargar el historial.';}}catch(e){if(valid())error.textContent=e.message;}}
 async function refresh(){if(!valid()||busy)return;busy=true;button.disabled=true;const requestedSport=sport;try{
  const next=await loadEffortRecords(client,user.id,requestedSport);if(!valid())return;if(sport!==requestedSport)return;
  data=next;error.textContent='';draw();
  if(Number(data.with_series)>Number(data.analysed)&&Date.now()-lastStarted>120000)void start();
 }catch(e){if(valid())error.textContent=e.message;}finally{busy=false;button.disabled=false;if(valid()&&requestedSport!==sport)void refresh();}}
 const change=e=>{sport=e.target.value;data=null;status.textContent='Consultando tu historial…';root.querySelector('[data-effort-table]').replaceChildren();detailDispose?.();root.querySelector('[data-effort-detail]').replaceChildren();void refresh();};
 root.querySelector('[data-effort-sport]').addEventListener('change',change);
 button.onclick=()=>void refresh();root.querySelector('[data-effort-retry]').onclick=async e=>{const retryButton=e.currentTarget;retryButton.disabled=true;await start(true);if(valid()){retryButton.disabled=false;await refresh();}};
 const click=e=>{const id=e.target.closest('[data-effort-activity]')?.dataset.effortActivity;if(!id)return;const record=(data?.records||[]).find(r=>r.activity_id===id&&r.metric===metric);if(!record)return;const host=root.querySelector('[data-effort-detail]');detailDispose?.();host.innerHTML='<div class="effort-detail-heading"><h3>Actividad del récord</h3><button type="button" class="hub-link" data-effort-close>Cerrar actividad ×</button></div><div data-effort-viewer></div>';detailDispose=mountActivityDetail({root:host.querySelector('[data-effort-viewer]'),client,userId:user.id,activityId:id});host.querySelector('[data-effort-close]').onclick=()=>{detailDispose?.();detailDispose=null;host.replaceChildren();};host.scrollIntoView?.({block:'start',behavior:'auto'});};
 root.addEventListener('click',click);void refresh();
 const timer=globalThis.setInterval(()=>{if(!valid()){globalThis.clearInterval(timer);return;}if(root.ownerDocument.visibilityState==='visible'&&(!data||Number(data.analysed)<Number(data.with_series)))void refresh();},5000);timer.unref?.();
 return ()=>{disposed=true;globalThis.clearInterval(timer);detailDispose?.();root.removeEventListener('click',click);};
}
