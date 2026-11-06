// The visible lines are a bounded graphical representation only.
// All FIT records remain intact in the decoding worker and can be paged below.
const NS='http://www.w3.org/2000/svg';
const WIDTH=760,HEIGHT=240;
const create=(doc,tag,txt)=>{const n=doc.createElement(tag);if(txt!==undefined)n.textContent=txt;return n;};
const svgNode=(doc,tag,attributes={})=>{const n=doc.createElementNS(NS,tag);
 for(const [key,value] of Object.entries(attributes))n.setAttribute(key,String(value));return n;};
export function mountFitCharts(root,charts){
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
 function draw(){
  const s=charts[Number(selector.value)||0];
  if(!s||!Array.isArray(s.points)||!s.points.length)return;
  svg.replaceChildren();
  const vals=s.points.map(p=>p.value).filter(Number.isFinite);
  if(!vals.length)return;
  const lo=Math.min(...vals),hi=Math.max(...vals),span=hi-lo||1;
  const left=62,top=22,width=WIDTH-left-20,height=HEIGHT-top-45;
  const x=p=>left+width*(p.index/Math.max(1,s.total-1));
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
  unit.textContent='Muestras: 1–'+s.total+' · '+s.unit;svg.append(unit);
  summary.textContent='Valores observados: '+s.observed+' de '+s.total+' registros. Mínimo '+lo.toLocaleString('es-ES')+
   ' '+s.unit+' · máximo '+hi.toLocaleString('es-ES')+' '+s.unit+'.';
 }
 selector.addEventListener('change',draw);draw();
}
