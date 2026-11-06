// Garmin Connect: interfaz del deportista. Los secretos se gestionan exclusivamente en Netlify Functions.
import {mountHistoryHub} from './garmin-history-hub.js';
import {mountCoachFitSharing} from './garmin-fit-sharing.js';
const el=(tag,cls,content)=>{
  const node=document.createElement(tag);
  if(cls)node.className=cls;
  if(content!==undefined)node.textContent=String(content);
  return node;
};
function note(parent,message){
  const status=el('p','garmin-note',message);
  status.setAttribute('role','status');
  parent.append(status);
  return status;
}
async function request(client,path,method='GET',payload){
  const session=await client.auth.getSession();
  const token=session.data?.session?.access_token;
  if(!token)throw new Error('Inicia sesión de nuevo para conectar Garmin.');
  const response=await fetch('/.netlify/functions/'+path,{
    method,cache:'no-store',credentials:'same-origin',
    headers:{Authorization:'Bearer '+token,...(payload?{'Content-Type':'application/json'}:{})},
    ...(payload?{body:JSON.stringify(payload)}:{}),
  });
  let body=null;
  try{body=await response.json();}catch{}
  if(!response.ok){
    if(response.status===503)throw new Error('La conexión Garmin todavía no está habilitada.');
    throw new Error('No se pudo completar la operación de Garmin.');
  }
  return body||{};
}
export async function mountGarminPanel({root,client,user,role,onNavigate}){
  if(!root||!client||!user?.id)return;
  root.replaceChildren();
  const wrap=el('section','garmin-module');
  wrap.append(el('h2','','Garmin Connect'));
  wrap.append(el('p','','Gestiona tu conexión y decide qué compartes. Tus actividades y gráficas están en Calendario.'));
  const connection=el('section','garmin-settings-card');connection.append(el('h3','','Cuenta Garmin'));wrap.append(connection);
  const returned=new URL(root.ownerDocument.location.href).searchParams;
  const notices={expired:'El enlace de autorización anterior caducó. Inicia una conexión nueva; tu sesión Garmin puede seguir abierta.',
    failed:'Garmin ha devuelto la autorización, pero el servidor no ha podido completar la conexión.',
    cancelled:'La autorización anterior no se completó.',not_ready:'La configuración del servidor requiere revisión antes de conectar Garmin.'};
  const issueNotices={token_http_400:'Garmin ha rechazado la solicitud de intercambio del código.',
    token_http_401:'Garmin ha rechazado la autenticación de la aplicación. Hay que revisar su Client Secret existente.',
    token_invalid_client:'Garmin identifica el rechazo como invalid_client: no acepta la autenticación de esta aplicación.',
    token_unauthorized_client:'Garmin identifica la aplicación como no autorizada para este intercambio.',
    token_invalid_grant:'Garmin rechaza el código de autorización o su comprobación PKCE.',
    token_invalid_request:'Garmin rechaza el formato de la solicitud de autorización.',
    token_http_401_html:'El endpoint Garmin ha devuelto una página HTML con estado 401; requiere revisar el acceso al servicio.',
    token_http_403:'Garmin ha denegado el intercambio de autorización de la aplicación.',
    token_http_429:'Garmin ha indicado un límite temporal de solicitudes.',
    token_http_other:'Garmin no ha podido completar el intercambio de autorización.',
    token_network:'No se pudo completar la comunicación del servidor con Garmin.',
    token_redirect:'Garmin devolvió una redirección inesperada; se ha detenido el intercambio para proteger las credenciales.',
    token_format:'La respuesta de autorización Garmin no tiene el formato esperado.',
    verifier_decryption:'No se pudo recuperar el estado cifrado de esta autorización.',
    identity_permissions:'No se pudieron comprobar la identidad y los permisos oficiales de Garmin.',
    connection_storage:'No se pudo guardar la conexión de forma segura.',
    quota:'La autorización está temporalmente limitada.',lease:'Otra operación de sincronización o su bloqueo requiere revisión.',
    state_storage:'No se pudo comprobar el estado de autorización.',consent_changed:'La versión de consentimiento cambió; inicia una conexión nueva.'};
  const returnedStatus=returned.get('garmin'),issue=returned.get('issue');
  if(Object.hasOwn(notices,returnedStatus)){
    const message=notices[returnedStatus]+(returnedStatus==='failed'&&Object.hasOwn(issueNotices,issue)?' '+issueNotices[issue]:'');
    note(connection,message);
  }
  const status=note(connection,'Comprobando disponibilidad de la conexión…');
  root.append(wrap);
  if(role!=='athlete'){
    status.textContent='La conexión la autoriza cada deportista desde su propia cuenta. Un entrenador no puede introducir sus claves Garmin.';
    const calendar=el('button','button primary','Ir a Calendario');calendar.type='button';calendar.addEventListener('click',()=>onNavigate?.('calendar'));wrap.append(calendar);
    return;
  }
  let result;
  const historyRoot=el('div');wrap.append(historyRoot);
  const disposeHistory=mountHistoryHub({root:historyRoot,client,user,onCalendar:()=>onNavigate?.('calendar')});
  const privacy=el('section','garmin-settings-card');privacy.append(el('h3','','Entrenador y privacidad'));
  const permissions=el('details','garmin-settings-details');permissions.append(el('summary','','Revisar qué comparto con mi entrenador'));
  const sharingRoot=el('div');permissions.append(sharingRoot);privacy.append(permissions);
  const manage=el('button','button secondary','Gestionar vinculaciones');manage.type='button';manage.addEventListener('click',()=>onNavigate?.('team'));privacy.append(manage);wrap.append(privacy);
  const disposeSharing=mountCoachFitSharing({root:sharingRoot,client,athleteId:user.id});
  const advanced=el('details','garmin-settings-details garmin-advanced');advanced.append(el('summary','','Opciones avanzadas'));
  advanced.append(el('p','','Solo para revisar archivos originales, incidencias de importación o umbrales de la exportación. Para consultar actividades utiliza Calendario.'));
  const advancedRoot=el('div');advanced.append(advancedRoot);wrap.append(advanced);
  let mounted=false,disposeAdvanced=()=>{};
  advanced.addEventListener('toggle',()=>{
    if(!advanced.open||mounted)return;mounted=true;advancedRoot.textContent='Abriendo herramientas de revisión…';
    void import('./garmin-original-ui.js').then(({mountOriginalVault})=>{
      if(!wrap.isConnected)return;advancedRoot.replaceChildren();disposeAdvanced=mountOriginalVault({root:advancedRoot,client,user,role,showSharing:false});
    }).catch(()=>{if(wrap.isConnected){advancedRoot.textContent='No se pudieron abrir las herramientas. Cierra y vuelve a abrir esta sección.';mounted=false;}});
  });
  const policy=el('p','garmin-privacy'),policyLink=el('a','','Privacidad y tratamiento de los datos de Garmin');
  policyLink.href='/privacidad-garmin.html';policyLink.target='_blank';policyLink.rel='noopener noreferrer';policy.append(policyLink);wrap.append(policy);
  const observer=new root.ownerDocument.defaultView.MutationObserver(()=>{if(!wrap.isConnected){disposeHistory();disposeSharing();disposeAdvanced();observer.disconnect();}});
  observer.observe(root.ownerDocument,{childList:true,subtree:true});
  try{result=await request(client,'garmin-status');}
  catch(error){if(root.isConnected)status.textContent=error.message;return;}
  if(!root.isConnected)return;
  if(!result.configured){
    status.textContent='La conexión Garmin todavía no está disponible en este entorno. Su configuración debe comprobarse en el servidor.';
    return;
  }
  if(result.connected){
    status.textContent='Garmin conectado';status.classList.add('garmin-connected');
    const p=Array.isArray(result.permissions)?result.permissions:[];
    const perms=el('ul','garmin-permissions');
    perms.append(el('li','',p.includes('ACTIVITY_EXPORT')?'Recibir actividades: autorizado':'Recibir actividades: sin autorización'),el('li','',p.includes('WORKOUT_IMPORT')?'Enviar entrenamientos: autorizado':'Enviar entrenamientos: sin autorización'));connection.append(perms);
    if(!result.activity_enabled||!result.training_enabled)connection.append(el('p','garmin-warning','Hay funciones de sincronización pendientes de activar. Los permisos de Garmin y la disponibilidad del servicio se comprueban por separado.'));
    const manageConnection=el('details','garmin-settings-details');manageConnection.append(el('summary','','Gestionar conexión'));
    manageConnection.append(el('p','','Para cambiar los permisos de actividades y entrenamientos, revisa AsturPower en las aplicaciones conectadas de Garmin Connect. Al desconectar aquí se revoca el acceso; tus actividades ya guardadas se conservan.'));
    manageConnection.append(el('p','','Las actividades nuevas reciben actualmente resúmenes. Las curvas históricas se preparan al importar la exportación; todavía no se reciben todos los FIT nuevos automáticamente.'));
    const official=el('a','','Abrir permisos en Garmin Connect');official.href='https://connect.garmin.com/modern/settings/accountInformation';official.target='_blank';official.rel='noopener noreferrer';manageConnection.append(official);
    const disconnect=el('button','button','Desconectar Garmin');
    disconnect.type='button';
    disconnect.addEventListener('click',async()=>{
      if(!window.confirm('¿Desconectar Garmin Connect de AsturPower? Se revocará el acceso y se eliminarán las credenciales guardadas.'))return;
      disconnect.disabled=true;
      status.textContent='Revocando autorización de Garmin…';
      try{
        const response=await request(client,'garmin-disconnect','POST');
        if(!response.disconnected)throw new Error('No se pudo desconectar Garmin.');
        await mountGarminPanel({root,client,user,role,onNavigate});
      }catch(error){
        status.textContent=error.message||'No se pudo desconectar Garmin. Inténtalo de nuevo.';
        disconnect.disabled=false;
      }
    });
    manageConnection.append(disconnect);connection.append(manageConnection);
    return;
  }
  status.textContent='Conexión disponible: debes autorizar personalmente qué datos compartes con AsturPower.';
  const consent=el('label','garmin-optin');
  const checkbox=el('input');checkbox.type='checkbox';
  consent.append(checkbox,el('span','','Acepto voluntariamente conectar mi cuenta Garmin y autorizo el tratamiento de los datos deportivos que seleccione en Garmin Connect, incluidos datos fisiológicos como la frecuencia cardíaca si están disponibles, para el seguimiento de mi entrenamiento por AsturPower y mi entrenador autorizado. He leído la información de privacidad y puedo retirar la autorización.'));
  const start=el('button','button primary','Conectar Garmin Connect');
  start.type='button';start.disabled=true;
  checkbox.addEventListener('change',()=>{start.disabled=!checkbox.checked;});
  start.addEventListener('click',async()=>{
    start.disabled=true;
    status.textContent='Abriendo la autorización oficial de Garmin…';
    try{
      const body=await request(client,'garmin-start','POST',{consent:true});
      const url=new URL(body.authorization_url);
      if(url.protocol!=='https:'||url.origin!=='https://connect.garmin.com'||url.pathname!=='/oauth2Confirm')
        throw new Error('La dirección de autorización Garmin no es válida.');
      window.location.assign(url.toString());
    }catch(error){
      status.textContent=error.message||'No se ha podido iniciar la conexión.';
      start.disabled=!checkbox.checked;
    }
  });
  connection.append(consent,start);
}

