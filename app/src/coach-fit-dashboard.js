import {resolveHistoricalTss} from './garmin-fit-analysis.js';
const PAGE_SIZE=500;
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','"':'&quot;',"'":'&#39;'}[c]));
const fmt=value=>value===null||value===undefined||!Number.isFinite(Number(value))?'—':Number(value).toLocaleString('es-ES',{maximumFractionDigits:1});
const date=value=>new Date(value).toLocaleDateString('es-ES');
export async function loadCoachFitDetails(client,coachId,athleteId){
 const auth=await client.auth.getUser();
 if(auth.error||auth.data?.user?.id!==coachId)throw new Error('La sesión del entrenador ha cambiado.');
 const link=await client.from('coach_athletes').select('athlete_id').eq('coach_id',coachId).eq('athlete_id',athleteId).eq('status','active').limit(1);
 if(link.error||link.data?.length!==1)throw new Error('El deportista no está vinculado activamente contigo.');
 const share=await client.from('athlete_coach_fit_sharing').select('athlete_id').eq('athlete_id',athleteId).eq('coach_id',coachId).limit(1);
 if(share.error)throw new Error('No se pudo comprobar el permiso deportivo.');
 if(share.data?.length!==1)return {allowed:false,activities:[],metrics:[],physiology:[]};
 async function allRows(factory,max=10000){
  const rows=[];
  for(let off=0;off<max;off+=PAGE_SIZE){
   const result=await factory().range(off,off+PAGE_SIZE-1);
   if(result.error||!Array.isArray(result.data))throw new Error('No se pudieron consultar los registros del deportista.');
   rows.push(...result.data);if(result.data.length<PAGE_SIZE)return rows;
  }
  throw new Error('Historial demasiado grande para mostrarlo completo de una vez.');
 }
 const [activities,metrics,ftpResult]=await Promise.all([
  allRows(()=>client.from('activities').select('id,athlete_id,title,started_at,sport,duration_seconds,distance_meters,elevation_gain_meters,avg_heart_rate,avg_power_watts,source')
   .eq('athlete_id',athleteId).order('started_at',{ascending:false})),
  allRows(()=>client.from('garmin_fit_analysis').select('activity_id,sport,fit_started_at,duration_seconds,sample_count,power_seconds,power_coverage,normalized_power_watts,match_offset_seconds,measurement_source')
   .eq('athlete_id',athleteId).order('fit_started_at',{ascending:false})),
  client.from('athlete_physiology').select('sport,effective_date,ftp,created_at').eq('athlete_id',athleteId)
   .eq('sport','cycling').order('effective_date',{ascending:false}).limit(500)
 ]);
 if(ftpResult.error)throw new Error('No se pudieron recuperar los FTP históricos del deportista.');
 const physiology=ftpResult.data||[];
 return {allowed:true,activities,physiology,
  metrics:metrics.map(x=>resolveHistoricalTss(x,physiology))};
}
function chart(root,items){
 root.replaceChildren();
 const vals=items.filter(x=>x.metric.normalized_power_watts!==null).slice().reverse().slice(-90);
 if(vals.length<2)return;
 const doc=root.ownerDocument,N='http://www.w3.org/2000/svg',make=(tag,attrs={})=>{
  const e=doc.createElementNS(N,tag);for(const [k,v] of Object.entries(attrs))e.setAttribute(k,String(v));return e;
 };
 const svg=make('svg',{viewBox:'0 0 820 230',role:'img','aria-label':'Evolución de potencia normalizada de las últimas 90 sesiones con NP'});
 svg.classList.add('perf-chart');const pad=36,low=Math.min(...vals.map(x=>Number(x.metric.normalized_power_watts))),high=Math.max(...vals.map(x=>Number(x.metric.normalized_power_watts)));
 const range=high-low||1,points=vals.map((x,i)=>{
  const px=pad+i*(820-2*pad)/(vals.length-1);
  const py=192-(Number(x.metric.normalized_power_watts)-low)*145/range;return px.toFixed(1)+','+py.toFixed(1);
 });
 svg.append(make('line',{x1:pad,x2:784,y1:192,y2:192,stroke:'currentColor','stroke-opacity':'.3'}));
 const poly=make('polyline',{points:points.join(' '),fill:'none',stroke:'#16a085','stroke-width':2.5,'stroke-linejoin':'round'});
 svg.append(poly);
 for(const [y,label] of [[38,high],[192,low]]){const t=make('text',{x:8,y:y+3,'font-size':12,fill:'currentColor'});t.textContent=fmt(label)+' W';svg.append(t);}
 root.append(svg);
}
export function mountCoachFitDashboard({root,client,coachId,athletes=[]}){
 const doc=root.ownerDocument;
 root.innerHTML=`<section class="perf-card"><span class="eyebrow">DATOS REALES DE GARMIN</span><h3>Análisis completo por deportista</h3>
 <p>Historial de actividades, potencia normalizada, cobertura de medición, FTP histórico y TSS. El deportista debe autorizar en Garmin el acceso a las métricas FIT. Los archivos originales y las rutas GPS permanecen privados.</p>
 <label class="perf-field"><span>Elegir deportista</span><select data-detailed-athlete><option value="">Selecciona un deportista</option>
 ${athletes.map(a=>`<option value="${esc(a.user_id)}">${esc(a.display_name)}</option>`).join('')}</select></label>
 <p data-detailed-status role="status" aria-live="polite">Selecciona a un deportista para revisar su historial real.</p>
 <div data-detailed-content></div></section>`;
 const select=root.querySelector('[data-detailed-athlete]'),status=root.querySelector('[data-detailed-status]'),content=root.querySelector('[data-detailed-content]');
 let epoch=0;
 async function refresh(){
  const ticket=++epoch,athleteId=select.value;content.replaceChildren();
  if(!athleteId){status.textContent='Selecciona un deportista.';return;}
  status.textContent='Comprobando permisos y cargando actividades FIT…';
  try{
   const result=await loadCoachFitDetails(client,coachId,athleteId);
   if(ticket!==epoch||!root.isConnected)return;
   if(!result.allowed){status.textContent='El deportista todavía no ha autorizado compartir sus métricas FIT. Puede activarlo o revocarlo desde Garmin → Compartir análisis deportivos.';return;}
   const byId=new Map(result.metrics.map(x=>[x.activity_id,x]));
   const merged=result.activities.map(a=>({activity:a,metric:byId.get(a.id)||null}));
   const withNp=result.metrics.filter(x=>x.normalized_power_watts!==null).length;
   const withTss=result.metrics.filter(x=>x.tss!==null).length;
   status.textContent='Acceso deportivo autorizado: '+result.activities.length.toLocaleString('es-ES')+' actividades, '+result.metrics.length.toLocaleString('es-ES')+' FIT vinculados, '+withNp+' con NP y '+withTss+' con TSS.';
   if(!withTss)content.append(doc.createTextNode('Aún no hay TSS: registra un FTP verificable con fecha de vigencia en la ficha deportiva. No se utilizará el FTP de hoy para el pasado.'));
   const curve=doc.createElement('div');chart(curve,merged.filter(x=>x.metric));
   if(curve.childNodes.length){const h=doc.createElement('h4');h.textContent='Evolución de NP (últimas 90 sesiones con datos)';content.append(h,curve);}
   const filter=doc.createElement('label');filter.className='perf-field';
   const text=doc.createElement('span');text.textContent='Filtrar por año';
   const year=doc.createElement('select');const option=doc.createElement('option');option.value='';option.textContent='Todos los años';year.append(option);
   const years=[...new Set(merged.map(x=>x.activity.started_at.slice(0,4)))].sort().reverse();
   for(const y of years){const o=doc.createElement('option');o.value=y;o.textContent=y;year.append(o);}
   filter.append(text,year);content.append(filter);
   const summary=doc.createElement('p'),tableHost=doc.createElement('div');tableHost.className='perf-scroll';
   content.append(summary,tableHost);
   let page=0;
   function render(){
    const listed=merged.filter(x=>!year.value||x.activity.started_at.startsWith(year.value));
    const pages=Math.max(1,Math.ceil(listed.length/40));page=Math.min(page,pages-1);
    summary.textContent='Actividades del período: '+listed.length+' · Página '+(page+1)+' de '+pages+'.';
    tableHost.replaceChildren();
    const table=doc.createElement('table');
    table.innerHTML='<thead><tr><th>Fecha</th><th>Deporte y actividad</th><th>Tiempo</th><th>Distancia</th><th>FC media</th><th>Potencia media</th><th>NP</th><th>IF</th><th>TSS</th><th>Cobertura potencia</th><th>Muestras</th><th>Fuente</th></tr></thead>';
    const tbody=doc.createElement('tbody');
    for(const {activity:a,metric:m} of listed.slice(page*40,(page+1)*40)){
     const tr=doc.createElement('tr');
     const values=[date(a.started_at),a.title,fmt(a.duration_seconds/60)+' min',a.distance_meters===null?'—':fmt(a.distance_meters/1000)+' km',
      fmt(a.avg_heart_rate),fmt(a.avg_power_watts),m?fmt(m.normalized_power_watts):'Sin FIT',
      m?fmt(m.intensity_factor):'—',m?fmt(m.tss):'—',
      m?fmt(Number(m.power_coverage)*100)+' %':'—',m?fmt(m.sample_count):'—',
      m?(m.measurement_source==='unverified'?'Sensor por verificar':m.measurement_source):'—'];
     for(const value of values){const td=doc.createElement('td');td.textContent=value;tr.append(td);}
     tbody.append(tr);
    }
    table.append(tbody);tableHost.append(table);
    const bar=doc.createElement('div');bar.className='garmin-catalog-pagination';
    if(page>0){const prev=doc.createElement('button');prev.type='button';prev.className='button secondary';prev.textContent='Anterior';prev.addEventListener('click',()=>{page--;render();});bar.append(prev);}
    if(page+1<pages){const next=doc.createElement('button');next.type='button';next.className='button secondary';next.textContent='Siguiente';next.addEventListener('click',()=>{page++;render();});bar.append(next);}
    tableHost.append(bar);
   }
   year.addEventListener('change',()=>{page=0;render();});render();
  }catch(error){if(ticket===epoch&&root.isConnected)status.textContent=error.message;}
 }
 select.addEventListener('change',refresh);return ()=>{epoch++;};
}
