import {resolveHistoricalTss,ftpForDate,activityCalendarDate,loadSourceLabel} from './garmin-fit-analysis.js';
import {loadSportSeries,renderSportSeries} from './garmin-sports-series.js';
import {savePhysiology} from './performance-data.js';
import {coachSessionEssentials} from './coach-session-essentials.js';
const PAGE_SIZE=500;
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','"':'&quot;',"'":'&#39;'}[c]));
const fmt=value=>value===null||value===undefined||!Number.isFinite(Number(value))?'—':Number(value).toLocaleString('es-ES',{maximumFractionDigits:1});
const fmtIf=value=>value===null||value===undefined?'—':Number(value).toLocaleString('es-ES',{maximumFractionDigits:3});
const date=value=>new Date(value).toLocaleDateString('es-ES');
function paintCoachEssentials(root,report){
 const doc=root.ownerDocument;root.replaceChildren();
 const heading=doc.createElement('h5');heading.textContent='Datos esenciales para el entrenador';root.append(heading);
 const grid=doc.createElement('dl');grid.className='coach-essentials-grid';
 for(const item of report.entries){
  const cell=doc.createElement('div'),term=doc.createElement('dt'),value=doc.createElement('dd'),origin=doc.createElement('small');
  term.textContent=item.label;
  value.textContent=item.value===null?'—':(item.key==='if'?fmtIf(item.value):fmt(item.value))+(item.unit?' '+item.unit:'');
  origin.textContent=item.source;
  cell.append(term,value,origin);grid.append(cell);
 }
 root.append(grid);
 const {ftp,if:garminIf,tss:garminTss}=report.originalGarmin;
 if(ftp!==null||garminIf!==null||garminTss!==null){
  const reference=doc.createElement('p');reference.className='perf-note';
  reference.textContent='Referencia original Garmin: FTP '+(ftp===null?'—':fmt(ftp)+' W')+' · IF '+fmtIf(garminIf)+' · TSS '+fmt(garminTss)+'. Los cálculos con FTP confirmado pueden diferir de los valores del dispositivo.';
  root.append(reference);
 }
 if(report.deviation){const notice=doc.createElement('p');notice.className='perf-note';notice.setAttribute('role','status');notice.textContent=report.deviation;root.append(notice);}
}

export async function loadCoachFitDetails(client,coachId,athleteId,{includeSeries=true}={}){
 const auth=await client.auth.getUser();
 if(auth.error||auth.data?.user?.id!==coachId)throw new Error('La sesión del entrenador ha cambiado.');
 const link=await client.from('coach_athletes').select('athlete_id').eq('coach_id',coachId).eq('athlete_id',athleteId).eq('status','active').limit(1);
 if(link.error||link.data?.length!==1)throw new Error('El deportista no está vinculado activamente contigo.');
 const share=await client.from('athlete_coach_fit_sharing').select('athlete_id,series_enabled').eq('athlete_id',athleteId).eq('coach_id',coachId).limit(1);
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
   .eq('athlete_id',athleteId).order('started_at',{ascending:false}).order('id')),
  allRows(()=>client.from('garmin_fit_analysis').select('activity_id,sport,fit_started_at,duration_seconds,sample_count,power_seconds,power_coverage,normalized_power_watts,match_offset_seconds,measurement_source,np_method,device_intensity_factor,device_tss,device_ftp_watts')
   .eq('athlete_id',athleteId).order('fit_started_at',{ascending:false}).order('activity_id')),
  client.from('athlete_physiology').select('id,sport,effective_date,ftp,lthr,hr_max,hr_rest,weight_kg,threshold_pace_seconds,power_zone_bounds,hr_zone_bounds,created_at').eq('athlete_id',athleteId)
   .eq('sport','cycling').order('effective_date',{ascending:false}).limit(500)
 ]);
 if(ftpResult.error)throw new Error('No se pudieron recuperar los FTP históricos del deportista.');
 const physiology=ftpResult.data||[];
 const seriesEnabled=share.data[0].series_enabled===true;
 const series=seriesEnabled&&includeSeries?await allRows(()=>client.from('garmin_activity_series').select('activity_id').eq('athlete_id',athleteId).eq('status','ready').order('activity_id')):[];
 return {allowed:true,activities,physiology,seriesEnabled,seriesIds:series.map(r=>r.activity_id),
  metrics:metrics.map(x=>resolveHistoricalTss(x,physiology))};
}
function chart(root,items,key='normalized_power_watts'){
 root.replaceChildren();
 const value=x=>key==='duration_seconds'?Number(x.activity.duration_seconds)/3600:key==='distance_meters'?(x.activity.distance_meters===null?null:Number(x.activity.distance_meters)/1000):['normalized_power_watts','tss','intensity_factor'].includes(key)?x.metric?.[key]??null:x.activity[key];
 const vals=items.filter(x=>value(x)!==null&&value(x)!==undefined&&Number.isFinite(Number(value(x)))).slice().sort((a,b)=>a.activity.started_at.localeCompare(b.activity.started_at));
 if(vals.length<2)return;
 const doc=root.ownerDocument,N='http://www.w3.org/2000/svg',make=(tag,attrs={})=>{
  const e=doc.createElementNS(N,tag);for(const [k,v] of Object.entries(attrs))e.setAttribute(k,String(v));return e;
 };
 const svg=make('svg',{viewBox:'0 0 820 230',role:'img','aria-label':'Valores reales por fecha en el período seleccionado'});
 svg.classList.add('perf-chart');const pad=50,low=Math.min(...vals.map(x=>Number(value(x)))),high=Math.max(...vals.map(x=>Number(value(x))));
 const first=Date.parse(vals[0].activity.started_at),last=Date.parse(vals.at(-1).activity.started_at),span=last-first||1;
 const range=high-low||1,points=vals.map((x,i)=>{
  const px=pad+(Date.parse(x.activity.started_at)-first)*(820-2*pad)/span;
  const py=192-(Number(value(x))-low)*145/range;return px.toFixed(1)+','+py.toFixed(1);
 });
 svg.append(make('line',{x1:pad,x2:784,y1:192,y2:192,stroke:'currentColor','stroke-opacity':'.3'}));
 const poly=make('polyline',{points:points.join(' '),fill:'none',stroke:'#16a085','stroke-width':2.5,'stroke-linejoin':'round'});
 svg.append(poly);
 for(const [y,label] of [[38,high],[192,low]]){const t=make('text',{x:4,y:y+3,'font-size':12,fill:'currentColor'});t.textContent=fmt(label);svg.append(t);}
 for(const [x,txt,anchor] of [[pad,date(vals[0].activity.started_at),'start'],[770,date(vals.at(-1).activity.started_at),'end']]){const t=make('text',{x,y:218,'font-size':12,fill:'currentColor','text-anchor':anchor});t.textContent=txt;svg.append(t);}
 root.append(svg);
}
export function mountCoachFitDashboard({root,client,coachId,athletes=[]}){
 const doc=root.ownerDocument;
 root.innerHTML=`<section class="perf-card"><span class="eyebrow">DATOS REALES DE GARMIN</span><h3>Historial y métricas FIT por deportista</h3>
 <p>Historial, curvas de evolución, FTP y zonas por fecha. Abre una actividad para consultar sus curvas, vueltas y registros cuando la preparación de series esté completada y autorizada. El ZIP personal y las rutas GPS permanecen privados.</p>
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
   if(!withTss)content.append(doc.createTextNode('Aún no hay TSS disponible. La preparación del historial recupera el IF/TSS de Garmin cuando exista. Para recalcularlo se necesita un FTP verificable con fecha de vigencia; el FTP de hoy no se aplica al pasado.'));
   content.append(doc.createTextNode('Series deportivas preparadas: '+result.seriesIds.length+'. '+(result.seriesEnabled?'Acceso a curvas autorizado.':'La compartición de curvas todavía no está autorizada.')));
   const editor=doc.createElement('details'),editorTitle=doc.createElement('summary');editorTitle.textContent='FTP y zonas históricos: registrar un cambio con su fecha';editor.append(editorTitle);
   const form=doc.createElement('form');
   form.innerHTML='<p>Registra cada cambio en su fecha real. Un FTP se aplica desde esa fecha hasta el siguiente cambio; no se supone que sea válido para todos los años. Si faltan fechas, revisa la configuración antes de interpretar TSS.</p><div class="perf-fields"><label class="perf-field">Fecha de vigencia<input name="effective_date" type="date" required></label><label class="perf-field">FTP (W)<input name="ftp" type="number" min="1" max="2500" required></label><label class="perf-field">Límites de zonas (% FTP, separados por comas)<input name="power_zone_bounds" type="text" maxlength="150" placeholder="Opcional: usa el modelo acordado"></label></div><button class="button secondary" type="submit">Guardar versión histórica</button><p role="status" data-history-save></p>';
   editor.append(form);content.append(editor);
   const versionList=doc.createElement('ul');
   for(const p of result.physiology){const li=doc.createElement('li');li.textContent=p.effective_date+' · FTP '+fmt(p.ftp)+' W · Zonas: '+(p.power_zone_bounds?.join(', ')||'sin definir');versionList.append(li);}editor.append(versionList);
   form.addEventListener('submit',async event=>{
    event.preventDefault();const button=form.querySelector('button'),message=form.querySelector('[data-history-save]');if(button.disabled)return;button.disabled=true;
    try{
     const values=Object.fromEntries(new doc.defaultView.FormData(form));
     const prior=result.physiology.filter(r=>r.effective_date<=values.effective_date).sort((a,b)=>b.effective_date.localeCompare(a.effective_date)||String(b.created_at).localeCompare(String(a.created_at)))[0]||{};
     await savePhysiology(client,coachId,athleteId,{...prior,...values,sport:'cycling'});
     if(ticket===epoch&&root.isConnected)await refresh();
    }catch(error){if(root.isConnected)message.textContent=error.message;}
    finally{button.disabled=false;}
   });
   const metricLabel=doc.createElement('label');metricLabel.className='perf-field';metricLabel.textContent='Gráfico de evolución por actividad';const metricChoice=doc.createElement('select');
   for(const [key,label] of [['duration_seconds','Duración (horas)'],['distance_meters','Distancia (km)'],['avg_heart_rate','Pulso medio (lpm)'],['avg_power_watts','Potencia media (W)'],['normalized_power_watts','Potencia normalizada (W)'],['intensity_factor','Factor de intensidad (IF)'],['tss','TSS disponible']]){const o=doc.createElement('option');o.value=key;o.textContent=label;metricChoice.append(o);}metricLabel.append(metricChoice);content.append(metricLabel);
   const curve=doc.createElement('div');content.append(curve);
   const filter=doc.createElement('label');filter.className='perf-field';
   const text=doc.createElement('span');text.textContent='Filtrar por año';
   const year=doc.createElement('select');const option=doc.createElement('option');option.value='';option.textContent='Todos los años';year.append(option);
   const years=[...new Set(merged.map(x=>x.activity.started_at.slice(0,4)))].sort().reverse();
   for(const y of years){const o=doc.createElement('option');o.value=y;o.textContent=y;year.append(o);}
   filter.append(text,year);content.append(filter);
   const summary=doc.createElement('p'),tableHost=doc.createElement('div');tableHost.className='perf-scroll';
   const detail=doc.createElement('section');detail.className='perf-card';detail.hidden=true;
   content.append(summary,tableHost,detail);let detailEpoch=0;
   let page=0;
   function render(){
    const listed=merged.filter(x=>!year.value||x.activity.started_at.startsWith(year.value));
    chart(curve,listed,metricChoice.value);
    const pages=Math.max(1,Math.ceil(listed.length/40));page=Math.min(page,pages-1);
    summary.textContent='Actividades del período: '+listed.length+' · '+fmt(listed.reduce((n,x)=>n+Number(x.activity.duration_seconds||0),0)/3600)+' h · '+fmt(listed.reduce((n,x)=>n+Number(x.activity.distance_meters||0),0)/1000)+' km · Página '+(page+1)+' de '+pages+'.';
    tableHost.replaceChildren();
    const table=doc.createElement('table');
    table.innerHTML='<thead><tr><th>Actividad</th><th>Fecha</th><th>Deporte y actividad</th><th>Tiempo</th><th>Distancia</th><th>FC media</th><th>Potencia media</th><th>NP</th><th>IF</th><th>TSS</th><th>Cobertura potencia</th><th>Muestras</th><th>Fuente NP</th><th>Fuente IF / TSS</th><th>Disponibilidad</th></tr></thead>';
    const tbody=doc.createElement('tbody');
    for(const {activity:a,metric:m} of listed.slice(page*40,(page+1)*40)){
     const tr=doc.createElement('tr');
     const openCell=doc.createElement('td'),open=doc.createElement('button');open.type='button';open.className='button secondary';open.textContent='Abrir';openCell.append(open);tr.append(openCell);
     open.addEventListener('click',async()=>{
      const inspection=++detailEpoch;detail.hidden=false;detail.replaceChildren();const h=doc.createElement('h4');h.textContent=a.title+' · '+date(a.started_at);detail.append(h);
      const description=doc.createElement('p');description.textContent=fmt(a.duration_seconds/60)+' min · '+fmt(a.distance_meters===null?null:a.distance_meters/1000)+' km · Desnivel '+fmt(a.elevation_gain_meters)+' m · Pulso '+fmt(a.avg_heart_rate)+' lpm · Potencia media '+fmt(a.avg_power_watts)+' W · NP '+fmt(m?.normalized_power_watts)+' W · IF '+fmtIf(m?.intensity_factor)+' · TSS '+fmt(m?.tss)+'.';detail.append(description);
      const historical=ftpForDate(result.physiology,activityCalendarDate(a.started_at));
      const essentials=doc.createElement('section');essentials.className='coach-session-essentials';detail.append(essentials);
      const updateEssentials=series=>paintCoachEssentials(essentials,coachSessionEssentials({activity:a,metric:m,physiology:historical,series}));
      updateEssentials(null);
      const body=doc.createElement('div');detail.append(body);
      if(!result.seriesEnabled){body.textContent='El deportista aún no ha autorizado compartir las curvas y registros.';return;}
      if(!result.seriesIds.includes(a.id)){body.textContent=m?'El FIT está vinculado, pero faltan las series compartibles. En la cuenta del deportista: Garmin → Completar series y revisar historial.':'Esta actividad aún no tiene un FIT asociado de forma verificable. El resumen permanece disponible; consulta el diagnóstico desde Garmin en la cuenta del deportista.';return;}
      body.textContent='Recuperando las series deportivas autorizadas…';
      try{const data=await loadSportSeries(client,coachId,athleteId,a.id);if(ticket!==epoch||inspection!==detailEpoch||!root.isConnected)return;
       if(!data){body.textContent='La serie ya no está disponible o el permiso ha cambiado.';return;}
       updateEssentials(data);renderSportSeries(body,data,{ftp:historical?.ftp,bounds:historical?.power_zone_bounds});
      }catch(error){if(ticket===epoch&&inspection===detailEpoch&&root.isConnected)body.textContent=error.message;}
     });
     const values=[date(a.started_at),a.title,fmt(a.duration_seconds/60)+' min',a.distance_meters===null?'—':fmt(a.distance_meters/1000)+' km',
      fmt(a.avg_heart_rate),fmt(a.avg_power_watts),m?fmt(m.normalized_power_watts):'Sin FIT',
      m?fmtIf(m.intensity_factor):'—',m?fmt(m.tss):'—',
      m?fmt(Number(m.power_coverage)*100)+' %':'—',m?fmt(m.sample_count):'—',
      m?(m.np_method==='device'?'Registrada por Garmin':m.np_method==='records_1s'?'Calculada desde muestras':'Sin NP verificable'):'—',
      m?'IF: '+loadSourceLabel(m.if_source)+' · TSS: '+loadSourceLabel(m.tss_source):'—',
      result.seriesIds.includes(a.id)?'Curvas y vueltas disponibles':!m?'Sin FIT vinculado':Number(m.power_seconds)===0?'FIT leído sin muestras de potencia':m.normalized_power_watts===null?'Potencia insuficiente para NP':'Series pendientes'];
     for(const value of values){const td=doc.createElement('td');td.textContent=value;tr.append(td);}
     tbody.append(tr);
    }
    table.append(tbody);tableHost.append(table);
    const bar=doc.createElement('div');bar.className='garmin-catalog-pagination';
    if(page>0){const prev=doc.createElement('button');prev.type='button';prev.className='button secondary';prev.textContent='Anterior';prev.addEventListener('click',()=>{page--;render();});bar.append(prev);}
    if(page+1<pages){const next=doc.createElement('button');next.type='button';next.className='button secondary';next.textContent='Siguiente';next.addEventListener('click',()=>{page++;render();});bar.append(next);}
    tableHost.append(bar);
   }
   year.addEventListener('change',()=>{page=0;detailEpoch++;detail.hidden=true;render();});metricChoice.addEventListener('change',render);render();
  }catch(error){if(ticket===epoch&&root.isConnected)status.textContent=error.message;}
 }
 select.addEventListener('change',refresh);if(athletes.length===1){select.value=athletes[0].user_id;void refresh();}return ()=>{epoch++;};
}
