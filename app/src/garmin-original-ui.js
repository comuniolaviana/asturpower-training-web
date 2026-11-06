import {uploadOriginal,listOriginals,downloadOriginal} from './garmin-original-vault.js';
import {mountOriginalViewer} from './garmin-original-viewer.js';
import {mountGarminHistoryImport} from './garmin-history-ui.js';
import {openPrivateGarminArchive} from './garmin-history-import.js';
export function mountOriginalVault({root,client,user,role}){
 if(!root||role!=='athlete'||!user?.id)return ()=>{};
 const doc=root.ownerDocument;
 function node(tag,text,cls){const n=doc.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;}
 const wrap=node('section',undefined,'garmin-originals');
 wrap.append(node('h3','Historial completo · Archivos originales'));
 wrap.append(node('p','Conserva una copia íntegra de la exportación de Garmin o de tus archivos FIT. Se mantienen todos sus bytes, incluidos los datos detallados y los campos que todavía no podemos interpretar.'));
 wrap.append(node('p','Los originales completos de la cuenta solo son accesibles para ti. La vinculación con un entrenador no le da acceso al archivo de tu cuenta.','subtle'));
 const pickLabel=node('label','Seleccionar archivo original'),input=node('input');input.type='file';input.setAttribute('aria-label','Archivo original de Garmin');pickLabel.append(input);
 const consent=node('label',undefined,'garmin-optin'),check=node('input');check.type='checkbox';consent.append(check,node('span','Quiero guardar una copia completa de este archivo en mi cuenta privada de AsturPower, incluidos los datos personales, deportivos, fisiológicos y de ubicación que contenga.'));
 const send=node('button','Guardar original completo','button primary');send.type='button';send.disabled=true;
 const cancel=node('button','Detener operación','button secondary');cancel.type='button';cancel.hidden=true;
 const inspect=node('button','Explorar archivo seleccionado','button secondary');inspect.type='button';inspect.disabled=true;
 const status=node('p','','garmin-note');status.setAttribute('role','status');status.setAttribute('aria-live','polite');
 const list=node('div'),refresh=node('button','Actualizar originales','button secondary');refresh.type='button';
 const viewerRoot=node('div'),viewer=mountOriginalViewer(viewerRoot);
 wrap.append(pickLabel,consent,send,cancel,inspect,status,refresh,list,viewerRoot);root.append(wrap);
 let file=null,busy=false,disposed=false,controller=null,browserController=null,epoch=0;
 const closeBrowser=node('button','Cerrar explorador de datos','button secondary');closeBrowser.type='button';closeBrowser.hidden=true;
 closeBrowser.addEventListener('click',()=>{browserController?.abort();browserController=null;viewer.dispose();closeBrowser.hidden=true;message('Explorador cerrado. Los originales permanecen intactos.');});
 viewerRoot.before(closeBrowser);
 const importDisposers=[];
 const stopImports=()=>{for(const dispose of importDisposers.splice(0))dispose();};
 const alive=()=>!disposed&&wrap.isConnected;
 function message(text){if(alive())status.textContent=text;}
 function lock(value){busy=value;input.disabled=value;check.disabled=value;send.disabled=value||!file||!check.checked;inspect.disabled=value||!file;refresh.disabled=value;cancel.hidden=!value;cancel.disabled=false;}
 input.addEventListener('change',()=>{file=input.files?.[0]||null;check.checked=false;lock(false);message(file?'Seleccionado: '+file.name+' · '+(file.size/1024/1024).toLocaleString('es-ES',{maximumFractionDigits:2})+' MB. Todavía no se ha subido.':'');});
 check.addEventListener('change',()=>{send.disabled=busy||!file||!check.checked;});
 inspect.addEventListener('click',()=>{if(file&&!busy)void viewer.open(file,file.name);});
 function progress(v){message(({checking:'Comprobando el original',uploading:'Guardando todos los bytes',downloading:'Recuperando el original'})[v.stage]+': '+Math.round(v.done/v.total*100)+' %.');}
 async function reload(){
  const ticket=++epoch;
  try{
   const rows=await listOriginals(client,user.id);if(!alive()||ticket!==epoch)return;stopImports();list.replaceChildren();
   if(!rows.length)list.append(node('p','Todavía no hay originales guardados.'));
   for(const row of rows){
    const card=node('article',undefined,'garmin-activity');card.append(node('strong',row.filename));
    card.append(node('p',(row.byte_size/1024/1024).toLocaleString('es-ES',{maximumFractionDigits:2})+' MB · '+(row.status==='ready'?'Original completo guardado':'Subida pendiente: selecciona el mismo original para reanudar')));
    if(row.status==='ready'){
     const download=node('button','Descargar original','button secondary');download.type='button';
     download.addEventListener('click',async()=>{
      if(busy||!alive())return;lock(true);controller=new AbortController();let writer=null;
      try{
       if(typeof doc.defaultView.showSaveFilePicker==='function'){
        const handle=await doc.defaultView.showSaveFilePicker({suggestedName:row.filename});writer=await handle.createWritable();
       }else if(row.byte_size>128*1024*1024)throw new Error('Para descargar este original grande, utiliza un ordenador con Chrome o Edge. La copia guardada sigue completa.');
       const original=await downloadOriginal(client,user.id,row.archive_id,{signal:controller.signal,onProgress:progress,...(writer?{onChunk:bytes=>writer.write(bytes)}:{})});
       if(writer){await writer.close();writer=null;}
       else if(alive()){
        const url=URL.createObjectURL(original.blob),a=node('a');a.href=url;a.download=original.filename;doc.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),10000);
       }
       message('Original recuperado y verificado, sin recortar datos.');
      }catch(error){if(writer)await writer.abort().catch(()=>{});message(error.name==='AbortError'?'Operación detenida. El original guardado se conserva.':error.message);}
      finally{controller=null;if(alive())lock(false);}
     });card.append(download);
     if(row.byte_size<=128*1024*1024){
      const explore=node('button','Explorar copia guardada','button secondary');explore.type='button';
      explore.addEventListener('click',async()=>{
       if(busy||!alive())return;lock(true);controller=new AbortController();
       try{
        const original=await downloadOriginal(client,user.id,row.archive_id,{signal:controller.signal,onProgress:progress});
        if(alive()){await viewer.open(original.blob,original.filename);message('Copia original recuperada y verificada.');}
       }catch(error){message(error.name==='AbortError'?'Operación detenida.':error.message);}
       finally{controller=null;if(alive())lock(false);}
      });card.append(explore);
     }
    }
    if(row.status==='ready'&&row.byte_size>128*1024*1024&&/\.zip$/i.test(row.filename)){
     const explore=node('button','Explorar todos los datos originales (FIT, TCX, GPS)','button secondary');explore.type='button';
     explore.addEventListener('click',async()=>{
      if(busy||!alive())return;
      browserController?.abort();viewer.dispose();browserController=new AbortController();const inspection=browserController;
      lock(true);explore.disabled=true;message('Abriendo el ZIP completo desde tu almacén privado…');
      try{
       const original=await openPrivateGarminArchive(client,user.id,row.archive_id,{signal:inspection.signal,
        onProgress:v=>message('Comprobando fragmentos privados: '+(v.done/1024/1024).toFixed(1)+' MB leídos.')});
       if(inspection.signal.aborted||!alive())return;
       closeBrowser.hidden=false;await viewer.open(original.blob,original.filename);
       message('Explorador de datos completos abierto. Puedes consultar los siete paquetes y todos sus FIT, TCX y otros archivos.');
      }catch(error){if(alive())message(error.name==='AbortError'?'Exploración detenida.':error.message);}
      finally{explore.disabled=false;if(alive())lock(false);}
     });card.append(explore);
    }
    if(row.status==='ready'&&/\.zip$/i.test(row.filename)){
     const importRoot=node('div',undefined,'garmin-history-import');card.append(importRoot);
     importDisposers.push(mountGarminHistoryImport({root:importRoot,client,ownerId:user.id,archiveId:row.archive_id}));
    }
    list.append(card);
   }
  }catch{if(alive()&&ticket===epoch)message('No se pudieron consultar los originales. Comprueba tu sesión y pulsa Actualizar originales.');}
 }
 send.addEventListener('click',async()=>{
  if(busy||!alive()||!file||!check.checked)return;lock(true);controller=new AbortController();const selected=file;
  try{
   const saved=await uploadOriginal(client,user.id,selected,{signal:controller.signal,onProgress:progress});if(!alive())return;
   message(saved.already_saved?'Este mismo original ya estaba guardado completo. No se ha duplicado.':'Original completo guardado. Aún no se ha convertido en actividades del calendario; puedes explorar sus datos detallados.');await reload();
  }catch(error){message(error.name==='AbortError'?'Subida detenida. Los fragmentos confirmados se conservan para reanudar con el mismo archivo.':error.message);}
  finally{controller=null;if(alive())lock(false);}
 });
 cancel.addEventListener('click',()=>{controller?.abort();cancel.disabled=true;});refresh.addEventListener('click',()=>void reload());
 const observer=new doc.defaultView.MutationObserver(()=>{if(!wrap.isConnected){disposed=true;controller?.abort();browserController?.abort();viewer.dispose();stopImports();observer.disconnect();}});
 observer.observe(doc,{subtree:true,childList:true});void reload();
 return ()=>{disposed=true;controller?.abort();browserController?.abort();viewer.dispose();stopImports();observer.disconnect();};
}
