import {zipEntries,unzipEntry} from './garmin-original-zip.js';
import {mountFitCharts} from './garmin-fit-chart-ui.js';
const LIMIT=50*1024*1024,PACK_LIMIT=64*1024*1024;
function el(doc,tag,text){const n=doc.createElement(tag);if(text!==undefined)n.textContent=text;return n;}
function readable(value){return JSON.stringify(value,(_key,v)=>typeof v==='bigint'?v.toString():v,2);}
export function mountOriginalViewer(root){
 const doc=root.ownerDocument,wrap=el(doc,'section'),status=el(doc,'p'),content=el(doc,'div');
 status.setAttribute('role','status');wrap.append(el(doc,'h4','Explorar el contenido original'),status,content);root.append(wrap);
 let worker=null,ticket=0,original=null;const active=n=>wrap.isConnected&&ticket===n;
 function stop(){ticket++;worker?.terminate();worker=null;content.replaceChildren();}
 function button(text,action){const b=el(doc,'button',text);b.type='button';b.className='button secondary';b.addEventListener('click',action);return b;}
 async function open(blob,name,depth=0,back=null){
  stop();const n=ticket;status.textContent='Abriendo '+name+'…';
  if(depth===0)original={blob,name};
  else if(back)content.append(button('Volver al paquete anterior',()=>void open(back.blob,back.name,depth-1,back.back)));
  else if(original)content.append(button('Volver al archivo original',()=>void open(original.blob,original.name)));
  if(depth>3){status.textContent='Hay varios ZIP anidados. El original completo sigue disponible para descargar.';return;}
  if(/\.zip$/i.test(name)){
   try{
    const entries=await zipEntries(blob);if(!active(n))return;
    status.textContent=entries.length+' archivos encontrados. Puedes buscar y abrir FIT, ZIP, JSON y texto.';
    const search=el(doc,'input');search.type='search';search.placeholder='Buscar archivo…';search.setAttribute('aria-label','Buscar dentro del original');
    const list=el(doc,'div'),navigation=el(doc,'div');let page=0;
    function render(){
     const filtered=entries.filter(e=>e.name.toLocaleLowerCase().includes(search.value.toLocaleLowerCase()));list.replaceChildren();navigation.replaceChildren();
     for(const entry of filtered.slice(page*25,page*25+25)){
      const row=el(doc,'p');row.append(button(entry.name,async()=>{
       const limit=/\.zip$/i.test(entry.name)?PACK_LIMIT:LIMIT;
       if(entry.size>limit){status.textContent='Esta entrada supera el límite de lectura individual del navegador. Sus bytes permanecen completos en el original.';return;}
       status.textContent='Leyendo '+entry.name+' desde el archivo privado…';
       try{const bytes=await unzipEntry(blob,entry,limit);if(active(n))await open(new Blob([bytes]),entry.name,depth+1,{blob,name,back});}
       catch(error){if(active(n))status.textContent=error.message;}
      }),el(doc,'span',' · '+(entry.size/1024).toLocaleString('es-ES',{maximumFractionDigits:1})+' KB'));list.append(row);
     }
     if(page)navigation.append(button('Anterior',()=>{page--;render();}));navigation.append(el(doc,'span','Página '+(page+1)));
     if((page+1)*25<filtered.length)navigation.append(button('Siguiente',()=>{page++;render();}));
    }
    search.addEventListener('input',()=>{page=0;render();});content.append(search,list,navigation);render();
   }catch(error){if(active(n))status.textContent=error.message+' El original se conserva completo.';}
   return;
  }
  if(/\.fit$/i.test(name)){
   if(blob.size>LIMIT){status.textContent='El FIT se conserva completo; su tamaño supera el límite de este visor.';return;}
   try{
    const bytes=await blob.arrayBuffer();if(!active(n))return;
    worker=new Worker(new URL('./garmin-full-fit-worker.js',import.meta.url),{type:'module'});
    worker.onerror=()=>{if(active(n))status.textContent='No se pudo abrir el visor FIT. El original sigue disponible.';};
    let selector=null,page=0;const pre=el(doc,'pre'),nav=el(doc,'div'),chartRoot=el(doc,'section');pre.className='original-records';
    function request(){worker?.postMessage({type:'page',messageType:selector.value,start:page*25});}
    worker.onmessage=({data})=>{
     if(!active(n))return;
     if(data.type==='error'){status.textContent=data.message;return;}
     if(data.type==='decoded'){
      status.textContent='FIT interpretado con el lector oficial de Garmin. Todos los campos y las muestras originales pueden consultarse por grupos.';
      mountFitCharts(chartRoot,data.charts||[]);
      selector=el(doc,'select');selector.setAttribute('aria-label','Grupo de datos FIT');
      for(const [type,count] of Object.entries(data.counts).filter(([,count])=>count)){
       const option=el(doc,'option',type+' · '+count+' registros');option.value=type;selector.append(option);
      }
      if(!selector.options.length){status.textContent='El FIT no contiene mensajes interpretables. Su original está conservado.';return;}
      selector.addEventListener('change',()=>{page=0;request();});content.append(chartRoot,el(doc,'p','Registros completos · elegir grupo de mensajes'),selector,nav,pre);request();
     }else if(data.type==='page'){
      pre.textContent=readable(data.rows);nav.replaceChildren();
      if(page)nav.append(button('25 anteriores',()=>{page--;request();}));
      nav.append(el(doc,'span',(data.start+1)+'–'+Math.min(data.start+25,data.total)+' de '+data.total));
      if(data.start+25<data.total)nav.append(button('25 siguientes',()=>{page++;request();}));
     }
    };worker.postMessage({type:'decode',bytes},[bytes]);
   }catch{if(active(n))status.textContent='No se pudo iniciar el lector FIT. El original sigue disponible.';}
   return;
  }
  if(/\.(json|txt|csv|xml|tcx|gpx)$/i.test(name)&&blob.size<=2*1024*1024){
   const text=await blob.text();if(!active(n))return;const pre=el(doc,'pre',text);pre.className='original-records';content.append(pre);status.textContent='Contenido original, sin ejecutar ni modificar.';
  }else status.textContent='Este formato no tiene vista previa. Se conserva íntegro dentro del original.';
 }
 return {open,dispose:stop};
}
