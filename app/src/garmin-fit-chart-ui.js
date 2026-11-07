import {measuredMinutes,measuredMinuteSamples,MINUTE_METRICS,OVERLAY_METRICS} from './garmin-fit-charts.js';
// The visible lines are a bounded graphical representation only.
// All FIT records remain intact in the decoding worker and can be paged below.
const NS='http://www.w3.org/2000/svg';
const WIDTH=760,HEIGHT=240;
const create=(doc,tag,txt)=>{const n=doc.createElement(tag);if(txt!==undefined)n.textContent=txt;return n;};
const svgNode=(doc,tag,attributes={})=>{const n=doc.createElementNS(NS,tag);
 for(const [key,value] of Object.entries(attributes))n.setAttribute(key,String(value));return n;};
export function mountFitCharts(root,charts,{records=null,startTime=null}={}){
 root.replaceChildren();
 if(!Array.isArray(charts)||!charts.length)return;
 const doc=root.ownerDocument;
 const heading=create(doc,'h5','Curvas de datos registrados');
 const note=create(doc,'p','La gráfica simplifica solamente el dibujo para que sea legible. Todos los registros FIT siguen disponibles sin recortes en el selector inferior.');
 note.className='garmin-fit-chart-note';
 const selector=create(doc,'select');
 selector.setAttribute('aria-label','Métrica de la curva FIT');
 for(let i=0;i<charts.length;i++){
  const item=create(doc,'option',charts[i].label+' ('+charts[i].unit+')');item.value=String(i);selector.append(item);
 }
 const summary=create(doc,'p');summary.className='garmin-fit-chart-note';
 const svg=svgNode(doc,'svg',{viewBox:'0 0 '+WIDTH+' '+HEIGHT,role:'img','aria-label':'Evolución de la métrica elegida'});
 svg.classList.add('garmin-fit-chart');
 root.append(heading,note,selector,summary,svg);
 const asTime=value=>{const ms=value instanceof Date?value.getTime():typeof value==='string'?Date.parse(value):NaN;return Number.isFinite(ms)?ms:null;};
 const times=Array.isArray(records)?records.map((r,index)=>({index,time:asTime(r.timestamp)})).filter(r=>r.time!==null).sort((a,b)=>a.time-b.time||a.index-b.index):[];
 const earliest=times[0]?.time,last=times.at(-1)?.time,sessionStart=asTime(startTime);
 const first=earliest===undefined?null:sessionStart!==null&&sessionStart<=earliest?sessionStart:earliest;
 const timed=first!==null&&last>first;
 const clock=seconds=>{const s=Math.max(0,Math.round(seconds));return [Math.floor(s/3600),Math.floor(s/60)%60,s%60].map(v=>String(v).padStart(2,'0')).join(':');};
 let cursor=null,currentScale=null,chosen=0;
 const inspect=create(doc,'section'),controls=create(doc,'div'),readout=create(doc,'p');inspect.className='activity-inspector';readout.setAttribute('role','status');
 const slider=create(doc,'input');slider.type='range';slider.min='0';slider.max=String(Math.max(0,(records?.length||1)-1));slider.step='1';slider.value='0';slider.setAttribute('aria-label','Recorrer todos los registros de la actividad');
 const minuteLabel=create(doc,'label','Ir al minuto de la actividad'),minute=create(doc,'input');minute.type='number';minute.min='0';minute.max=timed?String(Math.ceil((last-first)/60000)):'0';minute.step='any';minute.value='0';minute.setAttribute('aria-label','Ir al minuto de la actividad');minuteLabel.append(minute);
 if(Array.isArray(records)&&records.length){controls.append(slider);if(timed)controls.append(minuteLabel);inspect.append(create(doc,'h5','Consultar un momento de la actividad'),create(doc,'p','Mueve el control, toca la gráfica o introduce un minuto. Se muestra el registro medido más cercano, sin interpolar valores.'),controls,readout);root.append(inspect);}
 function nearest(time){
  let low=0,high=times.length;while(low<high){const mid=(low+high)>>1;if(times[mid].time<time)low=mid+1;else high=mid;}
  const after=times[Math.min(low,times.length-1)],before=times[Math.max(0,low-1)];return Math.abs(after.time-time)<Math.abs(before.time-time)?after.index:before.index;
 }
 function show(index){
  if(!Array.isArray(records)||!records.length)return;chosen=Math.max(0,Math.min(records.length-1,Math.round(index)));slider.value=String(chosen);
  const record=records[chosen],time=asTime(record.timestamp),s=charts[Number(selector.value)||0],parts=[];
  parts.push(time!==null&&first!==null?'Registro de '+clock((time-first)/1000)+' · '+new Date(time).toLocaleTimeString('es-ES'):'Registro '+(chosen+1));
  for(const c of charts){const v=record[c.key];if(typeof v==='number'&&Number.isFinite(v))parts.push(c.label+': '+v.toLocaleString('es-ES',{maximumFractionDigits:2})+' '+c.unit);}
  if(typeof record[s.key]!=='number'||!Number.isFinite(record[s.key]))parts.push(s.label+': sin dato en este registro');
  readout.textContent=parts.join(' · ');
  if(cursor&&currentScale){const fraction=timed&&time!==null?(time-first)/(last-first):chosen/Math.max(1,records.length-1),x=currentScale.left+currentScale.width*Math.max(0,Math.min(1,fraction));cursor.setAttribute('x1',x);cursor.setAttribute('x2',x);}
 }
 slider.addEventListener('input',()=>show(Number(slider.value)));
 minute.addEventListener('input',()=>{if(timed&&minute.value!==''&&Number.isFinite(minute.valueAsNumber)&&minute.valueAsNumber>=0)show(nearest(first+minute.valueAsNumber*60000));});
 function point(event){
  if(!currentScale||!records?.length)return;const rect=svg.getBoundingClientRect();if(!rect.width)return;
  const x=(event.clientX-rect.left)/rect.width*WIDTH,fraction=Math.max(0,Math.min(1,(x-currentScale.left)/currentScale.width));show(timed?nearest(first+fraction*(last-first)):fraction*(records.length-1));
 }
 svg.addEventListener('pointerdown',point);svg.addEventListener('pointermove',event=>{if(event.pointerType==='mouse'||event.buttons)point(event);});
 function draw(){
  const s=charts[Number(selector.value)||0];
  if(!s||!Array.isArray(s.points)||!s.points.length)return;
  svg.replaceChildren();
  const vals=s.points.map(p=>p.value).filter(Number.isFinite);
  if(!vals.length)return;
  const lo=Math.min(...vals),hi=Math.max(...vals),span=hi-lo||1;
  const left=62,top=22,width=WIDTH-left-20,height=HEIGHT-top-45;
  currentScale={left,width};
  const x=p=>{const t=records?asTime(records[p.index]?.timestamp):null;return left+width*(timed&&t!==null?(t-first)/(last-first):p.index/Math.max(1,s.total-1));};
  const y=p=>top+height*(1-(p.value-lo)/span);
  for(let i=0;i<5;i++){
   const py=top+height*i/4;
   svg.append(svgNode(doc,'line',{x1:left,x2:left+width,y1:py,y2:py,stroke:'#d5ded7','stroke-width':1}));
   const label=svgNode(doc,'text',{x:left-8,y:py+4,'text-anchor':'end','font-size':13,fill:'#345a49'});
   label.textContent=(hi-(hi-lo)*i/4).toLocaleString('es-ES',{maximumFractionDigits:1});
   svg.append(label);
  }
  const poly=svgNode(doc,'polyline',{points:s.points.map(p=>x(p).toFixed(1)+','+y(p).toFixed(1)).join(' '),
   fill:'none',stroke:'#087b5d','stroke-width':2,'stroke-linejoin':'round','stroke-linecap':'round'});
  svg.append(poly);
  const unit=svgNode(doc,'text',{x:left,y:HEIGHT-9,'font-size':13,fill:'#345a49'});
  unit.textContent=timed?'Tiempo: '+clock(0)+' — '+clock((last-first)/1000):'Muestras: 1–'+s.total+' · '+s.unit;svg.append(unit);
  if(records?.length){cursor=svgNode(doc,'line',{x1:left,x2:left,y1:top,y2:top+height,stroke:'#102527','stroke-width':1,'stroke-dasharray':'4 4'});svg.append(cursor);show(chosen);}
  summary.textContent='Valores observados: '+s.observed+' de '+s.total+' registros. Mínimo '+lo.toLocaleString('es-ES')+
   ' '+s.unit+' · máximo '+hi.toLocaleString('es-ES')+' '+s.unit+'.';
 }
 selector.addEventListener('change',draw);draw();
 renderMeasuredMinuteOverlay(root,records,startTime);
}


// Overlay uses an independent vertical scale for each sensor because W, lpm and rpm
// cannot share a meaningful numeric Y axis. The common X axis is elapsed time.
// Missing minutes break the trace; no value is interpolated.
export function renderMeasuredMinuteOverlay(root,records,startTime=null){
 if(!Array.isArray(records)||!records.length)return;
 // Derive available metrics from the actual permitted sport samples. The
 // interface never offers an empty sensor or guesses values for missing ones.
 const observed=new Set();
 for(const record of records){
  for(const metric of OVERLAY_METRICS){
   const v=record?.[metric.key];
   if(typeof v==='number'&&Number.isFinite(v)&&(metric.min===undefined||v>=metric.min))observed.add(metric.key);
  }
  if(observed.size===OVERLAY_METRICS.length)break;
 }
 const available=OVERLAY_METRICS.filter(metric=>observed.has(metric.key));
 if(!available.length)return;
 const minutes=measuredMinutes(records,startTime,available);
 if(!minutes.length)return;
 const doc=root.ownerDocument,section=create(doc,'section');
 section.className='garmin-minute-overlay';
 section.append(create(doc,'h5','Pulso, potencia y cadencia · superponer datos minuto a minuto'));
 const note=create(doc,'p','Marca las métricas que quieras comparar. La gráfica general muestra la evolución por minutos; selecciona un minuto para ampliar sus mediciones reales por segundo. No interpolamos huecos ni confundimos escalas de pulso, potencia y cadencia.');
 note.className='garmin-fit-chart-note';section.append(note);
 const availableKeys=new Set(available.map(metric=>metric.key));
 const selected=new Set(MINUTE_METRICS.map(metric=>metric.key).filter(key=>availableKeys.has(key)));
 if(!selected.size)selected.add(available[0].key);
 const pick=create(doc,'fieldset');pick.className='garmin-minute-metrics';
 const legendTitle=create(doc,'legend','Elegir datos para superponer');pick.append(legendTitle);
 for(const metric of available){
  const label=create(doc,'label'),check=create(doc,'input');
  check.type='checkbox';check.value=metric.key;check.checked=selected.has(metric.key);
  check.setAttribute('data-metric-toggle',metric.key);
  check.setAttribute('aria-label','Superponer '+metric.label);
  label.append(check,doc.createTextNode(' '+metric.label+' ('+metric.unit+')'));
  pick.append(label);
  check.addEventListener('change',()=>{if(check.checked)selected.add(metric.key);else selected.delete(metric.key);draw();});
 }
 section.append(pick);
 const svg=svgNode(doc,'svg',{viewBox:'0 0 760 260',role:'img','aria-label':'Comparación de métricas deportivas seleccionadas a lo largo de la actividad'});
 svg.classList.add('garmin-fit-chart');section.append(svg);
 const seriesLegend=create(doc,'div');seriesLegend.className='garmin-minute-legend';section.append(seriesLegend);
 const colors=['#c44753','#a16b10','#246db8','#087b5d','#8b54a2','#bc5b28','#52732d','#994769','#48688e','#8b642e','#486c67','#806aa7'];
 const left=50,right=745,top=22,bottom=204,axisWidth=right-left;
 const maxMinute=Math.max(1,minutes.at(-1).minute),byMinute=new Map(minutes.map(row=>[row.minute,row]));
 const x=minute=>left+Math.min(1,minute/maxMinute)*axisWidth;
 const label=create(doc,'label','Consultar minuto de la actividad');
 const input=create(doc,'input');input.type='number';input.min='0';input.max=String(maxMinute);input.step='1';input.value=String(minutes[0].minute);
 input.setAttribute('aria-label','Consultar promedios medidos en un minuto');input.setAttribute('data-minute-control','');
 label.append(input);section.append(label);
 const readout=create(doc,'p');readout.setAttribute('role','status');readout.setAttribute('data-minute-readout','');section.append(readout);
 // Drill down into the same selected 60-second window using original samples.
 const zoom=create(doc,'section');zoom.className='garmin-minute-zoom';
 const zoomTitle=create(doc,'h6','Detalle del minuto, segundo a segundo');
 const zoomNote=create(doc,'p','Cada punto corresponde a una muestra del FIT. Solo se unen puntos consecutivos separados como máximo 1,5 segundos; los huecos se dejan vacíos.');
 zoomNote.className='garmin-fit-chart-note';
 const zoomSvg=svgNode(doc,'svg',{viewBox:'0 0 760 250',role:'img','aria-label':'Curvas superpuestas de muestras reales del minuto seleccionado'});
 zoomSvg.classList.add('garmin-fit-chart');zoomSvg.setAttribute('data-second-overlay','');
 const zoomStatus=create(doc,'p');zoomStatus.setAttribute('role','status');zoomStatus.setAttribute('data-second-status','');
 const sampleLabel=create(doc,'label','Recorrer registros exactos del minuto');
 const sampleControl=create(doc,'input');sampleControl.type='range';sampleControl.min='0';sampleControl.max='0';sampleControl.step='1';sampleControl.value='0';
 sampleControl.setAttribute('aria-label','Recorrer muestras realmente grabadas dentro del minuto');
 sampleControl.setAttribute('data-second-control','');
 sampleLabel.append(sampleControl);
 const sampleReadout=create(doc,'p');sampleReadout.setAttribute('role','status');sampleReadout.setAttribute('data-second-readout','');
 const rawDetails=create(doc,'details'),rawSummary=create(doc,'summary','Ver muestras originales de este minuto');
 const rawHost=create(doc,'div');rawHost.className='perf-scroll';rawDetails.append(rawSummary,rawHost);
 zoom.append(zoomTitle,zoomNote,zoomSvg,zoomStatus,sampleLabel,sampleReadout,rawDetails);
 section.append(zoom);
 let zoomSamples=[],samplePage=0;
 function showSample(index){
  if(!zoomSamples.length){sampleReadout.textContent='Sin muestras registradas para este minuto.';return;}
  const at=Math.max(0,Math.min(zoomSamples.length-1,Math.round(index)));
  const row=zoomSamples[at];sampleControl.value=String(at);
  const parts=['Muestra real · segundo '+row.second.toLocaleString('es-ES',{maximumFractionDigits:3})+' · '+new Date(row.timestamp).toLocaleTimeString('es-ES')];
  for(const metric of available.filter(m=>selected.has(m.key))){
   const value=row.values[metric.key];
   parts.push(metric.label+': '+(value===null?'sin registro en esta muestra':format(value,metric.unit)));
  }
  sampleReadout.textContent=parts.join(' · ');
 }
 sampleControl.addEventListener('input',()=>showSample(Number(sampleControl.value)));
 function drawRaw(){
  if(!rawDetails.open)return;
  rawHost.replaceChildren();
  const picked=available.filter(m=>selected.has(m.key)),table=create(doc,'table'),head=create(doc,'tr'),thead=create(doc,'thead'),tbody=create(doc,'tbody');
  for(const heading of ['Segundo registrado',...picked.map(m=>m.label+' ('+m.unit+')')])head.append(create(doc,'th',heading));
  thead.append(head);table.append(thead);
  const from=samplePage*100,to=Math.min(zoomSamples.length,from+100);
  for(const row of zoomSamples.slice(from,to)){
   const tr=create(doc,'tr');tr.append(create(doc,'td',row.second.toLocaleString('es-ES',{maximumFractionDigits:3})+' s'));
   for(const metric of picked)tr.append(create(doc,'td',format(row.values[metric.key],metric.unit)));
   tbody.append(tr);
  }
  table.append(tbody);rawHost.append(table);
  rawHost.append(create(doc,'p','Registros '+(zoomSamples.length?from+1:0)+'–'+to+' de '+zoomSamples.length+'.'));
  for(const [label,offset] of [['Anterior',-1],['Siguiente',1]]){
   const button=create(doc,'button',label);button.type='button';button.className='button secondary';
   button.disabled=samplePage+offset<0||(samplePage+offset)*100>=zoomSamples.length;
   button.addEventListener('click',()=>{samplePage+=offset;drawRaw();});rawHost.append(button);
  }
 }
 rawDetails.addEventListener('toggle',drawRaw);
 function drawZoom(){
  const minute=Number(input.value);
  zoomSvg.replaceChildren();
  if(!Number.isSafeInteger(minute)||minute<0||minute>maxMinute){
   zoomStatus.textContent='Selecciona un minuto válido para consultar sus segundos.';
   zoomSamples=[];sampleLabel.hidden=true;sampleReadout.textContent='';drawRaw();return;
  }
  zoomTitle.textContent='Minuto '+minute+' · detalle segundo a segundo';
  zoomSamples=measuredMinuteSamples(records,startTime,minute,available);
  samplePage=0;
  sampleLabel.hidden=!zoomSamples.length;
  sampleControl.max=String(Math.max(0,zoomSamples.length-1));sampleControl.value='0';
  zoomStatus.textContent=zoomSamples.length
   ? zoomSamples.length+' registros reales en el minuto '+minute+'. Cada sensor solo aparece donde realmente fue medido.'
   : 'El minuto '+minute+' no contiene muestras grabadas. No se ha calculado ni interpolado ninguna curva.';
  const zx=second=>50+Math.max(0,Math.min(1,second/60))*695;
  const zTop=20,zBottom=207,zHeight=zBottom-zTop;
  for(let i=0;i<=4;i++){
   const y=zTop+zHeight*i/4;zoomSvg.append(svgNode(doc,'line',{x1:50,x2:745,y1:y,y2:y,stroke:'#bac8c1','stroke-width':1,'stroke-opacity':'.6'}));
  }
  for(const second of [0,15,30,45,60]){
   const mark=svgNode(doc,'text',{x:zx(second),y:237,'text-anchor':second===0?'start':second===60?'end':'middle','font-size':13,fill:'#345a49'});
   mark.textContent=second+' s';zoomSvg.append(mark);
  }
  const picked=available.filter(m=>selected.has(m.key));
  for(const metric of picked){
   const colored=zoomSamples.filter(row=>row.values[metric.key]!==null);
   if(!colored.length)continue;
   const values=colored.map(row=>row.values[metric.key]),min=Math.min(...values),max=Math.max(...values);
   const zy=value=>zTop+zHeight*(.85-.7*(value-min)/(max-min||1));
   const color=colors[available.indexOf(metric)%colors.length];
   let segment=[];
   const flush=()=>{
    if(segment.length>1){
     zoomSvg.append(svgNode(doc,'polyline',{points:segment.map(row=>zx(row.second).toFixed(2)+','+zy(row.values[metric.key]).toFixed(2)).join(' '),
      fill:'none',stroke:color,'stroke-width':2,'data-second-metric':metric.key}));
    }
    segment=[];
   };
   for(const row of zoomSamples){
    const value=row.values[metric.key];
    if(value===null){flush();continue;}
    if(segment.length&&row.second-segment.at(-1).second>1.5)flush();
    segment.push(row);
    zoomSvg.append(svgNode(doc,'circle',{cx:zx(row.second),cy:zy(value),r:2.1,fill:color,'data-second-metric':metric.key,'data-sample-second':row.second}));
   }
   flush();
  }
  if(zoomSamples.length)showSample(0);else sampleReadout.textContent='Sin registros para consultar.';
  drawRaw();
 }
 zoomSvg.addEventListener('pointerdown',event=>{
  if(!zoomSamples.length)return;
  const bounds=zoomSvg.getBoundingClientRect();if(!bounds.width)return;
  const px=(event.clientX-bounds.left)/bounds.width*760;
  const target=Math.max(0,Math.min(60,(px-50)/695*60));
  let index=0,best=Infinity;
  for(let i=0;i<zoomSamples.length;i++){
   const diff=Math.abs(zoomSamples[i].second-target);
   if(diff<best){index=i;best=diff;}
  }
  showSample(index); // Explicitly reports the timestamp of the measured sample.
 });

 const tableBox=create(doc,'details'),tableSummary=create(doc,'summary','Ver tabla minuto a minuto');
 const tableRoot=create(doc,'div');tableRoot.className='perf-scroll';
 tableBox.append(tableSummary,tableRoot);section.append(tableBox);
 let page=0;
 const format=(value,unit)=>value===null?'—':value.toLocaleString('es-ES',{maximumFractionDigits:1})+' '+unit;
 function write(){
  const minute=Number(input.value);
  if(!Number.isSafeInteger(minute)||minute<0||minute>maxMinute){readout.textContent='Minuto fuera de la actividad.';return;}
  const row=byMinute.get(minute);
  if(!row){readout.textContent='Minuto '+minute+': no hay muestras registradas.';return;}
  const parts=['Minuto '+minute+' ('+row.records+' registros)'];
  const chosen=available.filter(metric=>selected.has(metric.key));
  for(const metric of chosen){
   const value=row[metric.key],count=row.counts[metric.key];
   parts.push(metric.label+': '+(value===null?'sin datos':format(value,metric.unit)+' ('+count+' muestras)'));
  }
  if(!chosen.length)parts.push('elige al menos una métrica para consultar sus valores.');
  readout.textContent=parts.join(' · ');
 }
 input.addEventListener('input',()=>{write();drawZoom();});
 function table(){
  if(!tableBox.open)return;
  tableRoot.replaceChildren();
  const metrics=available.filter(m=>selected.has(m.key));
  const table=create(doc,'table'),head=create(doc,'tr'),thead=create(doc,'thead'),body=create(doc,'tbody');
  for(const title of ['Minuto',...metrics.map(m=>m.label+' ('+m.unit+')')])head.append(create(doc,'th',title));
  thead.append(head);table.append(thead);
  const start=page*60,end=Math.min(maxMinute+1,start+60);
  for(let minute=start;minute<end;minute++){
   const item=byMinute.get(minute),tr=create(doc,'tr');tr.append(create(doc,'td',String(minute)));
   for(const metric of metrics)tr.append(create(doc,'td',item?format(item[metric.key],metric.unit):'—'));
   body.append(tr);
  }
  table.append(body);tableRoot.append(table);
  const pagination=create(doc,'p','Minutos '+start+'–'+(end-1)+' de 0–'+maxMinute+'.');tableRoot.append(pagination);
  for(const [text,delta] of [['Anterior',-1],['Siguiente',1]]){
   const button=create(doc,'button',text);button.type='button';button.className='button secondary';
   button.disabled=page+delta<0||(page+delta)*60>maxMinute;
   button.addEventListener('click',()=>{page+=delta;table();});
   tableRoot.append(button);
  }
 }
 tableBox.addEventListener('toggle',table);
 function draw(){
  svg.replaceChildren();seriesLegend.replaceChildren();
  for(let i=0;i<=4;i++){
   const y=top+(bottom-top)*i/4;
   svg.append(svgNode(doc,'line',{x1:left,y1:y,x2:right,y2:y,stroke:'#bac8c1','stroke-width':1,'stroke-opacity':'.6'}));
  }
  const picked=available.filter(metric=>selected.has(metric.key));
  if(!picked.length)seriesLegend.append(create(doc,'p','Selecciona al menos un dato para dibujar la curva.'));
  for(const [index,metric] of picked.entries()){
   const values=minutes.map(row=>row[metric.key]).filter(v=>v!==null);
   if(!values.length)continue;
   const min=Math.min(...values),max=Math.max(...values);
   const y=value=>top+(bottom-top)*(.85-.7*(value-min)/(max-min||1));
   const color=colors[available.indexOf(metric)%colors.length],dashes=index>=colors.length?'6 3':null;
   let segment=[];
   const flush=()=>{
    if(segment.length===1){
     const row=segment[0];svg.append(svgNode(doc,'circle',{cx:x(row.minute),cy:y(row[metric.key]),r:2.5,fill:color,'data-metric':metric.key}));
    }else if(segment.length>1){
     const line=svgNode(doc,'polyline',{points:segment.map(row=>x(row.minute).toFixed(2)+','+y(row[metric.key]).toFixed(2)).join(' '),
      fill:'none',stroke:color,'stroke-width':2.5,'stroke-linecap':'round','stroke-linejoin':'round','data-metric':metric.key});
     if(dashes)line.setAttribute('stroke-dasharray',dashes);
     svg.append(line);
    }
    segment=[];
   };
   for(const row of minutes){
    if(row[metric.key]===null){flush();continue;}
    if(segment.length&&row.minute-segment.at(-1).minute!==1)flush();
    segment.push(row);
   }
   flush();
   const legend=create(doc,'p',metric.label+' ('+metric.unit+'): '+min.toLocaleString('es-ES',{maximumFractionDigits:1})+
    '–'+max.toLocaleString('es-ES',{maximumFractionDigits:1})+' · '+values.length+' min con datos'+(metric.aggregation==='last'?' · último del minuto':' · media de muestras'));
   legend.className='garmin-fit-chart-note';legend.style.color=color;seriesLegend.append(legend);
  }
  for(const minute of [0,Math.round(maxMinute/2),maxMinute]){
   const txt=svgNode(doc,'text',{x:x(minute),y:244,'text-anchor':minute===0?'start':minute===maxMinute?'end':'middle','font-size':13,fill:'#345a49'});
   txt.textContent=minute+' min';svg.append(txt);
  }
  write();table();drawZoom();
 }
 svg.addEventListener('pointerdown',event=>{
  const bounds=svg.getBoundingClientRect();if(!bounds.width)return;
  const px=(event.clientX-bounds.left)/bounds.width*760;
  input.value=String(Math.max(0,Math.min(maxMinute,Math.round((px-left)/axisWidth*maxMinute))));write();
 });
 draw();root.append(section);
}
