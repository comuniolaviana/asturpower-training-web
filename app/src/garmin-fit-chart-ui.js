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
}
