import {buildPMC} from './pmc.js';
import {loadPMCData} from './pmc-data.js';
import {activityCalendarDate,loadSourceLabel} from './garmin-fit-analysis.js';

const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt=v=>Number(v).toLocaleString('es-ES',{maximumFractionDigits:1});
const dateLabel=date=>new Date(date+'T12:00:00Z').toLocaleDateString('es-ES',{day:'numeric',month:'short'});
const keys=[['ctl','Carga · CTL'],['atl','Fatiga · ATL'],['tsb','Forma · TSB']];
const statCards=row=>keys.map(([key,label])=>`<div class="pmc-stat pmc-${key}"><span>${label}</span><strong>${row.hasKnown?fmt(row[key]):'—'}</strong></div>`).join('');

export function renderPMCChart(root,series,today,onSelect){
 const W=Math.max(300,Math.min(840,Math.round(root.clientWidth)||840)),mobile=W<600,H=mobile?300:350,L=mobile?38:52,R=mobile?38:56,T=28,B=40,plotW=W-L-R,plotH=H-T-B;
 const max=Math.max(10,...series.flatMap(r=>[r.ctl,r.atl]));
 const formMin=Math.min(-10,...series.map(r=>r.tsb)),formMax=Math.max(10,...series.map(r=>r.tsb));
 const x=i=>L+i*plotW/(series.length-1),y=v=>T+plotH-v/max*plotH,z=v=>T+plotH-(v-formMin)/(formMax-formMin)*plotH;
 const now=series.findIndex(r=>r.date===today);
 const points=(key,from,to)=>series.slice(from,to+1).map((r,i)=>`${x(i+from).toFixed(2)},${(key==='tsb'?z:y)(r[key]).toFixed(2)}`).join(' ');
 const paths=keys.map(([key])=>`<polyline class="pmc-line pmc-${key}" points="${points(key,0,now)}"/><polyline class="pmc-line pmc-${key} pmc-projection" points="${points(key,now,series.length-1)}"/>`).join('');
 const ticks=[0,.25,.5,.75,1].map(f=>`<line x1="${L}" x2="${W-R}" y1="${y(max*f)}" y2="${y(max*f)}" class="pmc-gridline"/><text x="${L-8}" y="${y(max*f)+4}" text-anchor="end">${fmt(max*f)}</text><text x="${W-R+8}" y="${y(max*f)+4}" class="pmc-form-label">${fmt(formMin+(formMax-formMin)*f)}</text>`).join('');
 const labels=[0,Math.round(now/2),now,series.length-1].filter((v,i,a)=>a.indexOf(v)===i).filter(i=>!(mobile&&i===series.length-1&&x(i)-x(now)<65)).map(i=>`<text x="${x(i)}" y="${H-12}" text-anchor="${i===0?'start':i===series.length-1?'end':'middle'}">${i===now?'Hoy':dateLabel(series[i].date)}</text>`).join('');
 root.innerHTML=`<svg class="pmc-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Carga y fatiga en el eje izquierdo; forma en el derecho. Línea continua: historial disponible. Discontinua: previsión. Selecciona una fecha debajo para consultar valores y sesiones."><rect x="${x(now)}" y="${T}" width="${W-R-x(now)}" height="${plotH}" class="pmc-future-bg"/>${ticks}<text x="${L}" y="15">CTL / ATL</text><text x="${W-R}" y="15" text-anchor="end" class="pmc-form-label">TSB</text><line x1="${L}" x2="${W-R}" y1="${z(0)}" y2="${z(0)}" class="pmc-zero"/><polygon points="${x(0)},${y(0)} ${points('ctl',0,now)} ${x(now)},${y(0)}" class="pmc-area"/>${paths}<line x1="${x(now)}" x2="${x(now)}" y1="${T}" y2="${H-B}" class="pmc-today-line"/><line data-pmc-cursor x1="${x(now)}" x2="${x(now)}" y1="${T}" y2="${H-B}" class="pmc-cursor"/>${labels}</svg>`;
 const svg=root.querySelector('svg');
 svg.addEventListener('click',event=>{
  const rect=svg.getBoundingClientRect();if(!rect.width)return;
  const px=(event.clientX-rect.left)*W/rect.width,index=Math.max(0,Math.min(series.length-1,Math.round((px-L)/plotW*(series.length-1))));
  onSelect(series[index].date);
 });
 return date=>{const i=series.findIndex(r=>r.date===date);if(i<0)return;const cursor=root.querySelector('[data-pmc-cursor]');cursor.setAttribute('x1',x(i));cursor.setAttribute('x2',x(i));};
}

export function mountPMC({root,client,coachId,athletes=[],loader=loadPMCData,clock=()=>new Date()}){
 let data=null,epoch=0,result=null,moveCursor=()=>{};
 const today=activityCalendarDate(clock());
 root.innerHTML=`<section class="perf-card pmc-panel"><div class="pmc-heading"><div><span class="eyebrow">EVOLUCIÓN Y PREVISIÓN</span><h3>Carga, fatiga y forma</h3><p>El estado actual y cómo puede evolucionar con la planificación.</p></div><span class="pmc-model-badge">Modelo CTL · ATL · TSB</span></div>
 <div class="pmc-controls"><label class="perf-field"><span>Deportista</span><select data-pmc-athlete><option value="">Selecciona un deportista</option>${athletes.map(a=>`<option value="${esc(a.user_id)}">${esc(a.display_name)}</option>`).join('')}</select></label><label class="perf-field"><span>Historial visible</span><select data-pmc-history><option value="30">30 días</option><option value="90" selected>90 días</option><option value="180">180 días</option><option value="365">365 días</option></select></label><label class="perf-field"><span>Días a futuro</span><input data-pmc-future type="number" min="1" max="90" step="1" value="21"></label><label class="perf-field"><span>Previsión</span><select data-pmc-mode><option value="calendar">Entrenamientos del calendario</option><option value="rest">Simular descanso completo</option></select></label></div>
 <p data-pmc-status role="status" aria-live="polite">Elige un deportista para consultar su evolución.</p><div data-pmc-content hidden><div class="pmc-summary"><div><h4>Hoy · ${dateLabel(today)}</h4><div class="pmc-stats" data-pmc-current></div></div><div><h4 data-pmc-target-title></h4><div class="pmc-stats" data-pmc-target></div></div></div>
 <div data-pmc-quality class="pmc-quality"></div><div class="pmc-legend"><span class="pmc-ctl">● Carga (CTL)</span><span class="pmc-atl">● Fatiga (ATL)</span><span class="pmc-tsb">● Forma (TSB)</span><span>Discontinua: previsión</span></div><div data-pmc-graph></div>
 <label class="perf-field pmc-date"><span>Consultar día · también puedes tocar la gráfica</span><input data-pmc-date type="date"></label><div data-pmc-day class="pmc-day" aria-live="polite"></div>
 <details><summary>Cómo se calcula y qué datos se utilizan</summary><p class="perf-note">CTL usa una constante de 42 días y ATL de 7. La forma TSB de cada fecha es el CTL menos el ATL del día anterior. El cálculo empieza en cero antes de la primera actividad recibida y usa todo el historial disponible, aunque solo muestres 30 o 90 días. Hoy incluye las actividades recibidas; la previsión empieza mañana. Los días futuros sin sesiones se simulan como descanso. Las actividades o sesiones sin TSS quedan indicadas como carga desconocida: las curvas usan únicamente las cargas disponibles y pueden infravalorar el total. Estos indicadores describen el modelo, no predicen un resultado deportivo.</p><p class="perf-note">Las sesiones futuras usan la carga que introduce el entrenador o una estimación por duración y potencia media objetivo de cada bloque. Los objetivos de pulso, RPE o texto libre requieren carga manual. El FTP actual no se aplica a años anteriores. La vista de descanso no modifica el calendario.</p></details></div></section>`;
 const $=s=>root.querySelector(s),status=$('[data-pmc-status]'),content=$('[data-pmc-content]');
 function selectDay(date){
  const row=result?.series.find(r=>r.date===date);if(!row)return;
  $('[data-pmc-date]').value=date;moveCursor(date);
  const source=item=>item.planned?item.source:loadSourceLabel(item.source);
  $('[data-pmc-day]').innerHTML=`<h4>${dateLabel(date)} · ${row.projected?'Previsión':'Historial recibido'}</h4><p>Carga diaria ${row.projected?'prevista':'disponible'}: <strong>${fmt(row.load)} TSS</strong>${row.missing?` · ${row.missing} sesión(es) con carga desconocida`:''}</p><div class="pmc-stats">${statCards(row)}</div>${row.items.length?`<ul>${row.items.map(item=>`<li><strong>${esc(item.title)}</strong> · ${item.load===null?'Carga desconocida':fmt(item.load)+' TSS'}<small>${esc(source(item))}</small></li>`).join('')}</ul>`:`<p class="pmc-muted">${row.projected?'Sin sesiones previstas: descanso en este escenario.':'Sin actividades recibidas para este día.'}</p>`}`;
 }
 function paint(){
  content.hidden=true;result=null;if(!data)return;
  try{
   result=buildPMC({...data,today,historyDays:Number($('[data-pmc-history]').value),futureDays:Number($('[data-pmc-future]').value),mode:$('[data-pmc-mode]').value});
   const target=result.target;
   $('[data-pmc-current]').innerHTML=statCards(result.today);$('[data-pmc-target]').innerHTML=statCards(target);
   $('[data-pmc-target-title]').textContent=`En ${$('[data-pmc-future]').value} días · ${dateLabel(target.date)}`;
   const issues=[];
   if(!result.today.hasKnown)issues.push('Aún no hay actividades con TSS disponible para calcular tu estado actual.');
   if(result.missingHistory)issues.push(`Historial parcial: ${result.missingHistory} actividades sin TSS. Los valores usan solo las cargas disponibles.`);
   if(result.missingFuture)issues.push(`Previsión parcial: ${result.missingFuture} sesiones sin carga estimada. Añade su carga en Calendario.`);
   if(!result.plannedCount)issues.push($('[data-pmc-mode]').value==='rest'?'Escenario de descanso completo.':'No hay sesiones futuras en el período: se simula descanso.');
   issues.push(`Inicio del modelo en cero${result.firstDate?' antes del '+dateLabel(result.firstDate)+' de '+result.firstDate.slice(0,4):''}.`);
   $('[data-pmc-quality]').textContent=issues.join(' ');
   const picker=$('[data-pmc-date]');picker.min=result.series[0].date;picker.max=target.date;
   const prior=picker.value,selected=result.series.some(r=>r.date===prior)?prior:today;
   content.hidden=false;
   moveCursor=renderPMCChart($('[data-pmc-graph]'),result.series,today,selectDay);selectDay(selected);
   status.textContent=`${data.activities.length.toLocaleString('es-ES')} actividades recibidas · ${result.plannedCount} sesiones previstas. Actualiza después de cambiar la planificación.`;
   content.hidden=false;
  }catch(error){status.textContent=error.message;}
 }
 $('[data-pmc-athlete]').addEventListener('change',async event=>{
  const ticket=++epoch,athleteId=event.target.value;data=null;result=null;content.hidden=true;$('[data-pmc-graph]').replaceChildren();$('[data-pmc-day]').replaceChildren();
  if(!athleteId){status.textContent='Selecciona un deportista.';return;}
  status.textContent='Cargando historial y planificación…';
  try{
   const next=await loader(client,coachId,athleteId);
   if(ticket!==epoch||!root.isConnected)return;
   if(!next.allowed){status.textContent='El deportista debe autorizar compartir sus métricas deportivas desde Mis vínculos → Garmin.';return;}
   data=next;paint();
  }catch(error){if(ticket===epoch&&root.isConnected)status.textContent=error.message;}
 });
 for(const selector of ['[data-pmc-history]','[data-pmc-future]','[data-pmc-mode]'])$(selector).addEventListener(selector==='[data-pmc-future]'?'input':'change',paint);
 $('[data-pmc-date]').addEventListener('change',event=>selectDay(event.target.value));
}
