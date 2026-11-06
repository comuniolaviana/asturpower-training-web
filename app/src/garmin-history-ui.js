import {previewGarminHistory,saveGarminHistory} from './garmin-history-import.js';

// Only the athlete can start this import. No background processing, no service key.
export function mountGarminHistoryImport({root,client,ownerId,archiveId}){
 const doc=root.ownerDocument;
 const create=(tag,txt,cls)=>{const n=doc.createElement(tag);if(txt!==undefined)n.textContent=txt;if(cls)n.className=cls;return n;};
 const open=create('button','Preparar importación de actividades','button secondary');open.type='button';
 const status=create('p','','garmin-note');status.setAttribute('role','status');status.setAttribute('aria-live','polite');
 const actions=create('div');root.append(open,status,actions);
 let preview=null,busy=false,controller=null,closed=false;
 const alive=()=>!closed&&root.isConnected;
 const progress=v=>{if(!alive())return;status.textContent=v.stage==='reading'?'Leyendo únicamente las partes necesarias del ZIP privado…':
  v.stage==='parsing'?'Analizando resúmenes: '+v.done+' de '+v.total:
  'Guardando actividades: '+v.done+' de '+v.total;};
 const unlock=()=>{busy=false;controller=null;if(alive())open.disabled=false;};
 open.addEventListener('click',async()=>{
  if(busy)return;busy=true;open.disabled=true;actions.replaceChildren();preview=null;controller=new AbortController();status.textContent='Localizando los resúmenes dentro del archivo guardado…';
  try{
   preview=await previewGarminHistory(client,ownerId,archiveId,{signal:controller.signal,onProgress:progress});
   if(!alive())return;
   const p=create('p',`Encontradas: ${preview.seen}. Válidas: ${preview.rows.length}. Omitidas por datos no válidos: ${preview.skipped}. Repetidas: ${preview.duplicates}.`);
   actions.append(p);
   if(preview.rows.length){
    const d=create('p',`Período: ${new Date(preview.earliest).toLocaleDateString('es-ES')} a ${new Date(preview.latest).toLocaleDateString('es-ES')}.`);actions.append(d);
    const consent=create('label',undefined,'garmin-optin'),check=create('input');check.type='checkbox';
    consent.append(check,create('span','Autorizo a incorporar estos resúmenes a mi historial deportivo. Mis entrenadores vinculados podrán ver estas actividades; el ZIP completo seguirá siendo privado.'));
    const save=create('button','Confirmar importación al historial','button primary');save.type='button';save.disabled=true;
    check.addEventListener('change',()=>{save.disabled=!check.checked||busy;});actions.append(consent,save);
    save.addEventListener('click',async()=>{
     if(busy||!check.checked||!preview)return;
     busy=true;open.disabled=true;check.disabled=true;save.disabled=true;controller=new AbortController();
     try{
      const result=await saveGarminHistory(client,ownerId,preview.rows,{signal:controller.signal,onProgress:progress});
      if(alive()){
       status.textContent=`Importación terminada: ${result.imported} actividades nuevas y ${result.existing} ya existentes. Las actividades están disponibles en el calendario.`;
       actions.replaceChildren();preview=null;
      }
     }catch(error){if(alive()){status.textContent=error.name==='AbortError'?'Importación detenida. Las actividades ya guardadas se conservan.':error.message;check.disabled=false;save.disabled=false;}}
     finally{unlock();}
    });
   }
   status.textContent=preview.rows.length?'Vista previa lista. No se ha guardado ninguna actividad todavía.':'No hay actividades válidas en esta exportación.';
  }catch(error){if(alive())status.textContent=error.name==='AbortError'?'Lectura cancelada.':error.message;}
  finally{unlock();}
 });
 return ()=>{closed=true;controller?.abort();};
}
