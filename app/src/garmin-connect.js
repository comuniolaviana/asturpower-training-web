// Garmin Connect: interfaz del deportista. Los secretos se gestionan exclusivamente en Netlify Functions.
import { loadGarminActivities } from './garmin-api.js';
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
export async function mountGarminPanel({root,client,user,role}){
  if(!root||!client||!user?.id)return;
  root.replaceChildren();
  const wrap=el('section','garmin-module');
  wrap.append(el('h2','','Garmin Connect'));
  wrap.append(el('p','','AsturPower puede planificar entrenamientos; la integración oficial con Garmin se está preparando para sincronizarlos y recibir actividades.'));
  const details=el('div','garmin-overview');
  details.append(el('p','','Envío: Training API · Acceso autorizado por Garmin. Pendiente de prueba real con un dispositivo compatible.'));
  details.append(el('p','','Recepción: Activity API · Pendiente de activar las notificaciones y probar la llegada de actividades.'));
  details.append(el('p','','Histórico anterior a la conexión: no incluido en Garmin Starter; requiere otra vía autorizada.'));
  wrap.append(details);
  const returned=new URL(root.ownerDocument.location.href).searchParams;
  const notices={expired:'El enlace de autorización anterior caducó. Inicia una conexión nueva; tu sesión Garmin puede seguir abierta.',
    failed:'Garmin ha devuelto la autorización, pero el servidor no ha podido completar la conexión.',
    cancelled:'La autorización anterior no se completó.',not_ready:'La configuración del servidor requiere revisión antes de conectar Garmin.'};
  const issueNotices={token_http_400:'Garmin ha rechazado la solicitud de intercambio del código.',
    token_http_401:'Garmin ha rechazado la autenticación de la aplicación. Hay que revisar su Client Secret existente.',
    token_http_403:'Garmin ha denegado el intercambio de autorización de la aplicación.',
    token_http_429:'Garmin ha indicado un límite temporal de solicitudes.',
    token_http_other:'Garmin no ha podido completar el intercambio de autorización.',
    token_network:'No se pudo completar la comunicación del servidor con Garmin.',
    token_format:'La respuesta de autorización Garmin no tiene el formato esperado.',
    verifier_decryption:'No se pudo recuperar el estado cifrado de esta autorización.',
    identity_permissions:'No se pudieron comprobar la identidad y los permisos oficiales de Garmin.',
    connection_storage:'No se pudo guardar la conexión de forma segura.',
    quota:'La autorización está temporalmente limitada.',lease:'Otra operación de sincronización o su bloqueo requiere revisión.',
    state_storage:'No se pudo comprobar el estado de autorización.',consent_changed:'La versión de consentimiento cambió; inicia una conexión nueva.'};
  const returnedStatus=returned.get('garmin'),issue=returned.get('issue');
  if(Object.hasOwn(notices,returnedStatus)){
    const message=notices[returnedStatus]+(returnedStatus==='failed'&&Object.hasOwn(issueNotices,issue)?' '+issueNotices[issue]:'');
    note(wrap,message);
  }
  const status=note(wrap,'Comprobando disponibilidad de la conexión…');
  root.append(wrap);
  if(role!=='athlete'){
    status.textContent='La conexión la autoriza cada deportista desde su propia cuenta. Un entrenador no puede introducir sus claves Garmin.';
    return;
  }
  let result;
  try{result=await request(client,'garmin-status');}
  catch(error){if(root.isConnected)status.textContent=error.message;return;}
  if(!root.isConnected)return;
  if(!result.configured){
    status.textContent='La conexión Garmin todavía no está disponible en este entorno. Su configuración debe comprobarse en el servidor.';
    return;
  }
  if(result.connected){
    status.textContent='Cuenta Garmin conectada a AsturPower.';
    const p=Array.isArray(result.permissions)?result.permissions:[];
    const perms=el('p','garmin-permissions','Permisos concedidos: '+(p.length?p.join(', '):'pendientes de comprobar'));
    wrap.append(perms);
    if(!p.includes('WORKOUT_IMPORT'))wrap.append(el('p','garmin-warning','No se ha concedido permiso para recibir entrenamientos en Garmin.'));
    if(!p.includes('ACTIVITY_EXPORT'))wrap.append(el('p','garmin-warning','No se ha concedido permiso para compartir actividades.'));
    wrap.append(el('p','garmin-warning',result.training_enabled
      ?'Puedes enviar tus sesiones estructuradas desde el calendario. La llegada al dispositivo requiere sincronizarlo con Garmin Connect.'
      :'El envío de entrenamientos está preparado y pendiente de activación y prueba real.'));
    wrap.append(el('p','garmin-warning',result.activity_enabled
      ?'Las actividades se mostrarán cuando Garmin entregue una notificación autorizada.'
      :'La recepción automática está preparada y pendiente de configurar las notificaciones oficiales.'));
    const disconnect=el('button','button','Desconectar Garmin');
    disconnect.type='button';
    disconnect.addEventListener('click',async()=>{
      if(!window.confirm('¿Desconectar Garmin Connect de AsturPower? Se revocará el acceso y se eliminarán las credenciales guardadas.'))return;
      disconnect.disabled=true;
      status.textContent='Revocando autorización de Garmin…';
      try{
        const response=await request(client,'garmin-disconnect','POST');
        if(!response.disconnected)throw new Error('No se pudo desconectar Garmin.');
        await mountGarminPanel({root,client,user,role});
      }catch(error){
        status.textContent=error.message||'No se pudo desconectar Garmin. Inténtalo de nuevo.';
        disconnect.disabled=false;
      }
    });
    wrap.append(disconnect);
    const recent=el('section','garmin-recent');
    recent.append(el('h3','','Actividades sincronizadas'));
    wrap.append(recent);
    try{
      const activities=await loadGarminActivities(client,user.id);
      if(!root.isConnected)return;
      if(!activities.length)recent.append(el('p','','Todavía no se han recibido actividades de Garmin.'));
      for(const activity of activities){
        const item=el('article','garmin-activity');
        item.append(el('strong','',activity.title));
        const date=new Date(activity.started_at);
        item.append(el('p','',date.toLocaleDateString('es-ES')+' · '+Math.round(activity.duration_seconds/60)+' min'
          +(activity.distance_meters!==null?' · '+(activity.distance_meters/1000).toLocaleString('es-ES',{maximumFractionDigits:2})+' km':'')));
        recent.append(item);
      }
    }catch{if(root.isConnected)recent.append(el('p','','Las actividades sincronizadas no se pueden consultar ahora.'));}
    return;
  }
  status.textContent='Conexión disponible: debes autorizar personalmente qué datos compartes con AsturPower.';
  const policy=el('p','garmin-privacy');
  const policyLink=el('a','', 'Información sobre privacidad y datos de Garmin');
  policyLink.href='https://asturpower-training.netlify.app/privacidad-garmin.html';
  if(root.ownerDocument.location.origin==='https://asturpower-garmin-dev.asturpower-training.workers.dev')
    policyLink.href='/privacidad-garmin.html';
  policyLink.target='_blank';policyLink.rel='noopener noreferrer';
  policy.append(policyLink);wrap.append(policy);
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
  wrap.append(consent,start);
}

