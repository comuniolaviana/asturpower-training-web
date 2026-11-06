import {loadFullCatalog,buildFullCatalog,readFullCatalogFile} from './garmin-full-catalog.js';

export function mountGarminFullCatalog({root,client,ownerId,archiveId,onOpen}){
 const doc=root.ownerDocument,el=(tag,text,cls)=>{
  const n=doc.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;
 };
 const wrap=el('section',undefined,'garmin-full-catalog');
 const title=el('h4','Todos los archivos originales de Garmin');
 const info=el('p','Crea un catálogo privado de todos los FIT, TCX y GPX. Los archivos completos ya están guardados en el ZIP; no se subirán otra vez ni se sustituirán por promedios.');
 const start=el('button','Crear o continuar índice completo','button secondary'),halt=el('button','Detener indexación','button secondary');
 start.type=halt.type='button';halt.hidden=true;
 const status=el('p','','garmin-note');status.setAttribute('role','status');status.setAttribute('aria-live','polite');
 const controls=el('div',undefined,'garmin-catalog-controls');
 const search=el('input');search.type='search';search.placeholder='Buscar cualquier archivo por nombre…';search.setAttribute('aria-label','Buscar archivo Garmin');search.disabled=true;
 const kinds=el('select');kinds.setAttribute('aria-label','Filtrar tipo de archivo');
 for(const [value,label] of [['','Todos los tipos'],['FIT','FIT'],['TCX','TCX'],['GPX','GPX'],['OTRO','Otros']]){
  const option=el('option',label);option.value=value;kinds.append(option);
 }
 kinds.disabled=true;controls.append(search,kinds);
 const list=el('div'),pager=el('div',undefined,'garmin-catalog-pagination');
 wrap.append(title,info,start,halt,status,controls,list,pager);root.append(wrap);
 let packs=[],all=[],page=0,busy=false,closed=false,controller=null,cache=null;
 const alive=()=>!closed&&wrap.isConnected;
 const reset=()=>{busy=false;controller=null;if(alive()){start.disabled=false;halt.hidden=true;}};
 function render(){
  all=packs.flatMap(pack=>pack.entries.map(item=>({...item,pack_name:pack.pack_name})));
  search.disabled=kinds.disabled=!all.length;
  const term=search.value.trim().toLocaleLowerCase(),kind=kinds.value;
  const filtered=all.filter(x=>(!kind||x.kind===kind)&&(!term||x.name.toLocaleLowerCase().includes(term)));
  if(page>Math.max(0,Math.ceil(filtered.length/20)-1))page=0;
  list.replaceChildren();pager.replaceChildren();
  const totals=all.reduce((acc,item)=>{acc[item.kind]=(acc[item.kind]||0)+1;return acc;},{});
  const caption=el('p','Indexados '+all.length.toLocaleString('es-ES')+' archivos en '+packs.length+' paquetes. FIT: '+(totals.FIT||0).toLocaleString('es-ES')+' · TCX: '+(totals.TCX||0)+' · GPX: '+(totals.GPX||0)+'.');
  list.append(caption,el('p','Resultados de búsqueda: '+filtered.length.toLocaleString('es-ES')+'. Los datos originales continúan en su ZIP privado.'));
  for(const item of filtered.slice(page*20,page*20+20)){
   const line=el('article',undefined,'garmin-catalog-file');
   const open=el('button','Abrir datos originales','button secondary');open.type='button';
   const details=el('span',item.kind+' · '+(item.byte_size/1024).toLocaleString('es-ES',{maximumFractionDigits:1})+' KB · '+item.name);
   line.append(open,details);list.append(line);
   open.addEventListener('click',async()=>{
    if(busy||!alive())return;
    busy=true;start.disabled=true;halt.hidden=false;controller=new AbortController();
    open.disabled=true;status.textContent='Recuperando archivo íntegro desde el ZIP privado…';
    try{
     const result=await readFullCatalogFile(client,ownerId,archiveId,item.pack_name,item.name,{
      signal:controller.signal,cache,onProgress:v=>{if(alive())status.textContent='Comprobados '+(v.done/1024/1024).toFixed(1)+' MB del paquete privado.';}
     });
     if(!alive()||controller.signal.aborted)return;
     cache=result.packCache;await onOpen(result.blob,result.name);
     if(alive())status.textContent='Archivo original abierto. El visor muestra todos los mensajes FIT y las curvas disponibles sin alterar el archivo.';
    }catch(error){if(alive())status.textContent=error.name==='AbortError'?'Lectura detenida.':error.message;}
    finally{open.disabled=false;reset();}
   });
  }
  if(page) {
   const previous=el('button','Anterior','button secondary');previous.type='button';
   previous.addEventListener('click',()=>{page--;render();});pager.append(previous);
  }
  pager.append(el('span','Página '+(page+1)+' de '+Math.max(1,Math.ceil(filtered.length/20))));
  if((page+1)*20<filtered.length){
   const next=el('button','Siguiente','button secondary');next.type='button';
   next.addEventListener('click',()=>{page++;render();});pager.append(next);
  }
 }
 async function reload(){
  try{const rows=await loadFullCatalog(client,ownerId,archiveId);
   if(!alive())return;packs=rows;render();
   status.textContent=rows.length?'Índice privado recuperado. Puedes buscar y abrir cualquier archivo.':'Todavía no se ha creado el índice del historial completo.';
  }catch{if(alive())status.textContent='No se ha podido comprobar el catálogo. Comprueba tu sesión.';}
 }
 search.addEventListener('input',()=>{page=0;render();});
 kinds.addEventListener('change',()=>{page=0;render();});
 halt.addEventListener('click',()=>{controller?.abort();halt.disabled=true;});
 start.addEventListener('click',async()=>{
  if(busy)return;
  busy=true;start.disabled=true;halt.hidden=false;halt.disabled=false;controller=new AbortController();
  status.textContent='Creando índice privado. Se leerán los paquetes Garmin de uno en uno. La operación se puede reanudar.';
  try{
   const indexed=await buildFullCatalog(client,ownerId,archiveId,{signal:controller.signal,onProgress:v=>{
    if(!alive())return;
    status.textContent=v.stage==='indexing'?'Paquetes indexados: '+v.done+' de '+v.total+' · Archivos localizados: '+v.files.toLocaleString('es-ES'):
     v.stage==='package'?'Abriendo paquete '+(v.done+1)+' de '+v.total+'…':
     'Leyendo el original privado: '+(v.done/1024/1024).toFixed(1)+' MB.';
   }});
   if(!alive())return;
   packs=indexed;render();status.textContent='Índice completo guardado: '+all.length.toLocaleString('es-ES')+' archivos. El ZIP original se conserva íntegro y privado.';
  }catch(error){if(alive()){status.textContent=error.name==='AbortError'?'Indexación detenida. Puedes reanudarla sin repetir los paquetes guardados.':error.message;await reload();}}
  finally{reset();if(alive())halt.disabled=false;}
 });
 void reload();
 return ()=>{closed=true;controller?.abort();cache=null;};
}
