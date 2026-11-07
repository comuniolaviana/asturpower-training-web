// Installation is user initiated. Never reload an active upload or FIT analysis.
export function mountInstallApp(win=window){
 const doc=win.document;
 const installed=()=>win.matchMedia?.('(display-mode: standalone)').matches||win.navigator.standalone===true;
 if(installed())register();
 else {
  const section=doc.createElement('aside');section.className='app-install';section.setAttribute('aria-label','Instalar AsturPower');
  const info=doc.createElement('div'),title=doc.createElement('strong'),note=doc.createElement('p');
  title.textContent='AsturPower en tu móvil';note.textContent='Ábrela con su propio icono, en una ventana independiente.';
  info.append(title,note);
  const button=doc.createElement('button');button.type='button';button.className='button primary';button.textContent='Instalar aplicación';
  const close=doc.createElement('button');close.type='button';close.className='app-install-close';close.textContent='×';close.setAttribute('aria-label','Cerrar aviso de instalación');
  section.append(info,button,close);doc.body.append(section);
  let prompt=null;
  close.addEventListener('click',()=>{section.hidden=true;});
  win.addEventListener('beforeinstallprompt',event=>{event.preventDefault();prompt=event;section.hidden=false;button.disabled=false;button.textContent='Instalar aplicación';});
  win.addEventListener('appinstalled',()=>{prompt=null;section.remove();});
  win.matchMedia?.('(display-mode: standalone)').addEventListener?.('change',event=>{if(event.matches)section.remove();});
  button.addEventListener('click',async()=>{
   if(prompt){
    const current=prompt;prompt=null;button.disabled=true;
    try{await current.prompt();const result=await current.userChoice;if(result.outcome==='accepted')section.remove();}
    catch{note.textContent='Abre el menú del navegador y elige «Instalar aplicación» o «Añadir a pantalla de inicio».';}
    finally{button.disabled=false;}
    return;
   }
   section.dataset.instructions='true';
   note.textContent=/iPad|iPhone|iPod/.test(win.navigator.userAgent)?'En Safari: Compartir → Añadir a pantalla de inicio → Añadir.':'En Chrome: menú ⋮ → Añadir a pantalla de inicio → Instalar. Si aparece «Crear acceso directo», recarga esta página y vuelve a probar.';
   note.setAttribute('role','status');button.textContent='Ver opciones de instalación';
  });
  register();
 }
 function register(){
  if(!win.isSecureContext||!('serviceWorker' in win.navigator))return;
  // Development previews must not leave a worker controlling future tests.
  if(import.meta.env?.DEV)return;
  const start=()=>{void win.navigator.serviceWorker.register('/sw.js',{scope:'/',updateViaCache:'none'}).then(reg=>{
   // An update waits for all old windows to close; no skipWaiting or reload.
   void reg.update().catch(()=>{});
  }).catch(()=>{});};
  if(doc.readyState==='complete')start();else win.addEventListener('load',start,{once:true});
 }
}
