import {mountBasics,mountWeight,mountZones,mountNews} from './athlete-hub-ui.js';
import {unreadNews} from './athlete-hub-data.js';
import {bindPush} from './push-client.js';
import { requestTeam } from './team-api.js';
import { mountPlanner } from './planning.js';
import { mountPerformance } from './performance-ui.js';
import { mountAccountEmail } from './account-email.js';
import { mountGarminPanel } from './garmin-connect.js';
import { renderTeamManagement } from './team-ui.js';
import { loadDashboard, saveProfile, messageFor, ROLE_LABELS, STATUS_LABELS } from './data.js';

const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const glyphs = {
  home: '<path d="m3 10 9-7 9 7v10H3z"/><path d="M9 20v-7h6v7"/>',
  people: '<circle cx="9" cy="7" r="3"/><path d="M3 21v-3a6 6 0 0 1 12 0v3M16 4a3 3 0 0 1 0 6M18 14a5 5 0 0 1 3 4v3"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4M17 3v4M3 10h18"/>',
  activity: '<path d="M3 12h4l3-7 4 14 3-7h4"/>',
  arrow: '<path d="M5 12h14m-6-6 6 6-6 6"/>',
  lock: '<rect x="5" y="10" width="14" height="11" rx="3"/><path d="M8 10V7a4 4 0 0 1 8 0M12 14v3"/>',
  refresh: '<path d="M20 8a8 8 0 1 0 0 8M20 3v5h-5"/>',
  bell: '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/>',
  heart: '<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z"/>',
  bolt: '<path d="m13 2-9 12h7l-1 8 10-13h-8z"/>',
  weight: '<path d="M5 3h14l3 18H2zM9 6h6l-1 4h-4z"/>',
  logout: '<path d="M10 4H4v16h6M9 12h12m-5-5 5 5-5 5"/>',
};
const icon = name => `<svg viewBox="0 0 24 24" aria-hidden="true">${glyphs[name] || glyphs.home}</svg>`;
const brand = `<a class="brand" href="#" aria-label="AsturPower Training, inicio"><span class="brand-symbol">ϟ</span><span>ASTUR<b>POWER</b><small>TRAINING</small></span></a>`;
const contact = 'mailto:AsturPower.Training@gmail.com';
const empty = (title, text, symbol = 'people') => `<div class="empty-state"><span class="empty-icon">${icon(symbol)}</span><h3>${title}</h3><p>${text}</p></div>`;

export function showUnavailable(root) {
  root.innerHTML = `<main class="unavailable">${brand}<div class="unavailable-card">${icon('lock')}<span class="eyebrow">ÁREA PRIVADA</span><h1>Estamos preparando<br>tu espacio.</h1><p>El acceso de pruebas aún no está disponible. Puedes contactar con el equipo para conocer el siguiente paso.</p><a class="button primary" href="${contact}">Contactar con AsturPower ${icon('arrow')}</a></div><span class="subtle">AsturPower Training · Entrenar con propósito</span></main>`;
}

export function mountApp(root, client, { fixture = false, teamRequest = requestTeam } = {}) {
  const params=new URL(root.ownerDocument.location.href).searchParams;
  const oauthResult=params.get('garmin');
  let user = null, data = null, view = ['connected','failed','expired','cancelled','not_ready'].includes(oauthResult)?'garmin':params.get('view')==='news'?'news':'overview', epoch = 0, disposed = false, query = '';
  let actionBusy = false, logoutBusy = false, ignoreSession = false, teamBusy = false, teamPage = 0, preferredRole = null;
  let emailNotice = '', emailNoticeUser = null, hubDispose=null, calendarDate=null;
  const cleanupHub=()=>{hubDispose?.();hubDispose=null;};
  const navigateHub=(next,date)=>{calendarDate=date||null;view=next;render();};
  const banner = fixture ? '<div class="fixture-banner">VISTA DE PRUEBA · DATOS FICTICIOS</div>' : '';

  function login(message = '', retryLogout = false) {
    cleanupHub();void bindPush(root.ownerDocument.defaultView,null).catch(()=>{});
    root.innerHTML = `${banner}<main class="login-layout"><section class="login-story">${brand}<div class="story-copy"><span class="eyebrow">TU ESPACIO DE ENTRENAMIENTO</span><h1>Cada persona.<br>Cada paso.<br><em>Un propósito.</em></h1><p>Un lugar para conectar a entrenadores y deportistas. Empieza por tu equipo.</p><div class="story-route" aria-hidden="true"><svg viewBox="0 0 500 150"><path d="M0 130C100 130 80 50 180 75S300 150 350 50 430 80 500 15"/><circle cx="350" cy="50" r="8"/></svg></div></div><p class="story-footer">ASTURIAS · ENTRENAR CON PROPÓSITO</p></section><section class="login-access"><span class="environment"><span></span> Entorno de pruebas</span><div class="login-form-wrap"><span class="section-number">01 / ACCESO</span><h2>Vuelve a tu equipo.</h2><p class="intro">Entra con tu cuenta de AsturPower Training.</p><form id="login-form"><label for="email">Correo electrónico</label><input id="email" name="email" type="email" autocomplete="username" placeholder="tu@correo.com" required maxlength="254"><label for="password">Contraseña</label><input id="password" name="password" type="password" autocomplete="current-password" placeholder="Tu contraseña" required><p class="form-message" id="login-message" role="alert">${esc(message)}</p><button class="button primary wide" type="submit">Entrar en mi espacio ${icon('arrow')}</button></form><div class="access-help">${icon('lock')}<p>El acceso se habilita de forma supervisada.<br>¿Necesitas ayuda? <a href="${contact}">Escríbenos</a></p></div></div><footer class="login-footer">Tu preparación empieza por una buena conexión.</footer></section></main>`;
    if (retryLogout) {
      const retry = root.ownerDocument.createElement('button');
      retry.type = 'button'; retry.className = 'button secondary wide';
      retry.setAttribute('data-logout', ''); retry.textContent = 'Reintentar cierre de sesión';
      root.querySelector('#login-form').after(retry);
    }
    root.querySelector('#login-form').addEventListener('submit', signIn);
  }

  function loading() {
    cleanupHub();
    root.innerHTML = `${banner}<main class="loading-screen">${brand}<div class="loading-dot"></div><p role="status">Preparando tu espacio…</p></main>`;
  }

  function announce(message, error = false) {
    const slot = root.querySelector('#notice');
    if (slot) { slot.textContent = message; slot.classList.toggle('notice-error', error); }
  }

  function profileForm(onboarding = false) {
    return `<section class="panel profile-panel"><span class="eyebrow">${onboarding ? 'PRIMER PASO' : 'TU CUENTA'}</span><h2>${onboarding ? '¿Cómo te llamamos?' : 'Mi perfil'}</h2><p>${onboarding ? 'Guarda tu nombre para preparar tu espacio. El equipo asignará tu tipo de acceso.' : 'El nombre que verá tu equipo. Tu correo y tipo de acceso se gestionan por separado.'}</p><form id="profile-form"><label for="display-name">Nombre visible</label><input id="display-name" name="display_name" type="text" autocomplete="name" maxlength="100" required value="${esc(data?.profile?.display_name || '')}" placeholder="Tu nombre"><p class="profile-email">Correo de acceso <strong>${esc(user.email || '')}</strong></p><button class="button primary" type="submit">Guardar perfil ${icon('arrow')}</button><p id="profile-message" class="form-message" role="alert"></p></form></section>`;
  }

  function athleteCards() {
    const list = data.athletes.filter(a => a.display_name.toLocaleLowerCase('es').includes(query.toLocaleLowerCase('es')));
    if (!data.athletes.length) return empty('Tu equipo empieza aquí.', 'Cuando se active una vinculación, encontrarás aquí el perfil de tu deportista.');
    if (!list.length) return empty('No encontramos ese nombre.', 'Prueba con otro nombre o borra la búsqueda.');
    return `<div class="athlete-grid">${list.map(a => `<button class="athlete-card" data-athlete="${esc(a.user_id)}"><span class="avatar">${esc(initials(a.display_name))}</span><span class="athlete-info"><strong>${esc(a.display_name)}</strong><small>Deportista · Vinculación activa</small></span><span class="card-arrow">${icon('arrow')}</span></button>`).join('')}</div>`;
  }

  function teamContent() {
    return `<section class="panel team-panel"><div class="panel-heading"><div><span class="eyebrow">PERSONAS, ANTES QUE NÚMEROS</span><h2>Mis deportistas</h2></div><span class="count-pill">${data.athletes.length} activos</span></div><label class="search-label" for="athlete-search">Buscar por nombre</label><input class="search" id="athlete-search" type="search" placeholder="Buscar en mi equipo…" maxlength="100" value="${esc(query)}"><div id="athlete-list">${athleteCards()}</div></section>`;
  }

  function overview() {
    const active=data.relationships.filter(r=>r.status==='active').length;
    const cards=data.role==='coach' ? [['calendar','Calendario','calendar','Sesiones y actividades'],['team','Mis deportistas','people',`${active} vinculaciones activas`],['performance','Rendimiento','activity','Carga, fatiga y forma'],['profile','Mi perfil','user','Mi cuenta y mis datos']] : [['calendar','Calendario','calendar','Actividades y entrenamientos'],['team','Mis vínculos','people',active?`${active} entrenador${active===1?'':'es'} · Garmin`:'Entrenador y Garmin'],['profile','Mi perfil','user','Mi ficha deportiva'],['weight','Mi peso','weight','Evolución y registros']];
    return `<div class="hub-home"><section class="hub-shortcuts" aria-label="Accesos rápidos">${cards.map(([id,title,symbol,note])=>`<button class="hub-shortcut" data-view="${id}"><span class="shortcut-icon">${icon(symbol)}</span><strong>${title}</strong><small>${note}</small><span class="shortcut-arrow" aria-hidden="true">↗</span></button>`).join('')}</section><section class="hub-news"><div class="hub-section-heading"><h2>Novedades</h2><button class="hub-link" data-view="news">Ver todas →</button></div><div id="hub-news-home"></div></section></div>${data.role==='coach'?teamContent():''}`;
  }

  function render() {
    if (!user || !data) return;
    cleanupHub();
    void bindPush(root.ownerDocument.defaultView,user.id).catch(()=>{});
    const roleLabel = ROLE_LABELS[data.role] || 'Acceso pendiente';
    const name = data.profile?.display_name || 'Tu espacio';
    const currentTitle=({profile:'Mi perfil',team:data.role==='athlete'?'Mis vínculos':'Mis deportistas',calendar:'Calendario',performance:'Rendimiento',garmin:'Garmin Connect',weight:'Mi peso','zones-hr':'Mis zonas de pulso','zones-power':'Mis zonas de potencia',news:'Novedades'})[view]||'Inicio';
    const managed = renderTeamManagement(data);
    const roleSwitcher = data.roles.length > 1 ? `<label class="workspace-switcher" for="workspace-role">Tu espacio<select id="workspace-role">${data.roles.map(role => `<option value="${role}" ${data.role === role ? 'selected' : ''}>${ROLE_LABELS[role]}</option>`).join('')}</select></label>` : '';
    const content = !data.profile ? profileForm(true) : view === 'profile' ? profileForm() : !data.role
      ? `<section class="panel pending-panel">${icon('lock')}<span class="eyebrow">PERFIL PREPARADO</span><h2>El siguiente paso es con tu equipo.</h2><p>Tu cuenta está pendiente de asignación de acceso. Contacta con AsturPower para habilitar tu espacio de entrenador o deportista.</p><a class="button primary" href="${contact}">Contactar con el equipo ${icon('arrow')}</a></section>`
      : data.role === 'admin' ? managed || `<section class="panel pending-panel">${icon('people')}<h2>Tu acceso de administración está identificado.</h2><p>La gestión de altas y vinculaciones está pendiente de habilitación. Tu perfil ya está disponible.</p><button class="button primary" data-view="profile">Revisar mi perfil ${icon('arrow')}</button></section>`
      : view === 'weight' && data.role==='athlete' ? '<div id="hub-weight"></div>'
      : ['zones-hr','zones-power'].includes(view) && data.role==='athlete' ? '<div id="hub-zones"></div>'
      : view === 'news' ? '<div id="hub-news-all"></div>'
      : view === 'performance' && data.role === 'coach' ? '<div id="performance-panel"></div>'
      : view === 'calendar' ? '<section class="panel planner-panel"><div id="planning-calendar"></div></section>'
      : view === 'garmin' ? '<section class="panel"><div id="garmin-connect-panel"></div></section>'
      : view === 'team' ? (data.role==='coach'?teamContent():`<div class="hub-connections">${managed||'<section class="panel"><h2>Mi entrenador</h2><p>No se pudieron consultar las vinculaciones. Pulsa Actualizar.</p></section>'}<section class="panel"><div id="garmin-connect-panel"></div></section></div>`) : overview();
    root.innerHTML = `${banner}<div class="app-shell hub-shell hub-view-${esc(view)}"><aside class="sidebar">${brand}${roleSwitcher}<div class="workspace-label">MI ESPACIO</div><nav aria-label="Navegación principal">${navItem('overview', 'Inicio', 'home')}${data.role === 'coach' ? navItem('team', 'Mis deportistas', 'people') : ''}${data.role === 'coach' ? navItem('performance', 'Rendimiento', 'activity') : ''}${['coach', 'athlete'].includes(data.role) ? navItem('calendar', 'Calendario', 'calendar') : ''}${data.role==='athlete'?navItem('team','Mis vínculos','people'):data.role==='coach'?navItem('garmin','Garmin','activity'):''}${data.role==='athlete'?navItem('weight','Mi peso','weight'):''}${navItem('profile', 'Mi perfil', 'user')}</nav><div class="sidebar-bottom"><div class="sidebar-note"><span class="mini-dot"></span> Entorno de pruebas<p>Paso a paso, hacia<br>tu mejor versión.</p></div><button class="logout" data-logout>${icon('logout')} Cerrar sesión</button></div></aside><div class="workspace"><header class="topbar"><div class="hub-mobile-brand">${brand}${data.roles.length>1?`<select class="hub-role-select" aria-label="Cambiar espacio" data-mobile-role>${data.roles.map(role=>`<option value="${role}" ${role===data.role?'selected':''}>${ROLE_LABELS[role]}</option>`).join('')}</select>`:''}</div><span class="hub-breadcrumb">Mi espacio <i>/</i> <strong>${currentTitle}</strong></span><div class="hub-header-actions">${data.role==='athlete'?`<button type="button" class="hub-icon-button" data-view="zones-hr" aria-label="Mis zonas de frecuencia cardíaca">${icon('heart')}</button><button type="button" class="hub-icon-button" data-view="zones-power" aria-label="Mis zonas de potencia">${icon('bolt')}</button>`:''}<button type="button" class="hub-icon-button" data-view="news" aria-label="Notificaciones y novedades">${icon('bell')}<span class="notification-count" data-news-count hidden></span></button><button type="button" class="hub-icon-button hub-mobile-logout" data-logout aria-label="Cerrar sesión">${icon('logout')}</button></div><span class="identity"><span class="identity-text">${esc(name)}<small>${roleLabel}</small></span><span class="avatar small">${esc(initials(name))}</span></span></header><main id="main-content"><div class="page-heading"><div><span class="eyebrow">ASTURPOWER TRAINING</span><h1>${view === 'overview' ? `Hola, ${esc(name)}<span class="lime-period">.</span>` : currentTitle}</h1><p>${view==='overview'?'Tu día, de un vistazo.':view==='calendar'?'Tu actividad, día a día.':view==='team'?'Conexiones y permisos.':''}</p></div><button class="button secondary" data-refresh>${icon('refresh')} Actualizar</button></div><p id="notice" class="notice" role="status" aria-live="polite"></p>${content}<footer class="workspace-footer"><span>Entrenar con propósito.</span><span>AsturPower Training</span></footer></main></div><nav class="hub-bottom-nav" aria-label="Accesos del móvil">${navItem('overview','Inicio','home')}${['coach','athlete'].includes(data.role)?navItem('calendar','Calendario','calendar')+navItem('team',data.role==='coach'?'Equipo':'Vínculos','people'):''}${navItem('profile','Perfil','user')}</nav></div><dialog id="athlete-detail"><button class="dialog-close" data-close-dialog aria-label="Cerrar ficha">×</button><div id="athlete-detail-content"></div></dialog><dialog id="team-confirm"><button class="dialog-close" data-close-team aria-label="Cerrar confirmación">×</button><div id="team-confirm-content"></div></dialog>`;
    root.querySelector('#profile-form')?.addEventListener('submit', submitProfile);
    if (view === 'profile' && data.profile) {
      if(data.role==='athlete'){const basicRoot=root.ownerDocument.createElement('div');root.querySelector('#profile-form').closest('section').after(basicRoot);void mountBasics({root:basicRoot,client,user});}
      const emailRoot = root.ownerDocument.createElement('details');emailRoot.className='hub-disclosure hub-account-email';emailRoot.innerHTML='<summary>Correo y acceso a mi cuenta</summary>';const emailContent=root.ownerDocument.createElement('div');emailRoot.append(emailContent);
      root.querySelector('#profile-form').closest('section').after(emailRoot);
      const accountUser = user;
      mountAccountEmail({root:emailContent,client,user:accountUser,notice:emailNoticeUser===user.id?emailNotice:'',onRequested:message=>{emailNotice=message;emailNoticeUser=accountUser.id;}});
    }
    if(root.querySelector('#hub-weight'))void mountWeight({root:root.querySelector('#hub-weight'),client,user});
    if(root.querySelector('#hub-zones'))void mountZones({root:root.querySelector('#hub-zones'),client,user,kind:view==='zones-power'?'power':'hr'});
    const newsRoot=root.querySelector('#hub-news-home,#hub-news-all');
    if(!newsRoot&&['athlete','coach'].includes(data.role))void updateNewsBadge();
    if(newsRoot)hubDispose=mountNews({root:newsRoot,client,user,all:view==='news',onNavigate:navigateHub,onCount:count=>{const badge=root.querySelector('[data-news-count]');if(badge){badge.hidden=!count;badge.textContent=count>99?'99+':String(count);}}});
    const performanceRoot = root.querySelector('#performance-panel');
    if (performanceRoot && data.role === 'coach') {
      void mountPerformance({root:performanceRoot,client,user,role:data.role,athletes:data.athletes});
    }
    const garminRoot = root.querySelector('#garmin-connect-panel');
    if (garminRoot && ['coach', 'athlete'].includes(data.role)) {
      void mountGarminPanel({root:garminRoot,client,user,role:data.role,onNavigate:next=>{if(!['calendar','team'].includes(next))return;view=next;render();}});
    }
    const calendarRoot = root.querySelector('#planning-calendar');
    if (calendarRoot && ['coach', 'athlete'].includes(data.role)) {
      void mountPlanner({ root: calendarRoot, client, user, role: data.role, initialDate:calendarDate });
    }
    root.querySelector('#athlete-search')?.addEventListener('input', event => {
      query = event.target.value;
      root.querySelector('#athlete-list').innerHTML = athleteCards();
    });
  }

  function navItem(id, label, symbol) {
    return `<button class="nav-item ${view === id ? 'selected' : ''}" data-view="${id}" ${view === id ? 'aria-current="page"' : ''}>${icon(symbol)} ${label}${view === id ? '<span class="nav-dot"></span>' : ''}</button>`;
  }

  async function sync() {
    if (ignoreSession || disposed) return;
    const ticket = ++epoch;
    data = null;
    loading();
    try {
      const auth = await client.auth.getUser();
      if (ticket !== epoch || disposed) return;
      if (auth.error || !auth.data.user) { user = null; login(); return; }
      user = auth.data.user;
      const next = await loadDashboard(client, user, preferredRole);
      if (next.profile && next.role) {
        try { next.team = await teamRequest(client, null, teamPage, fetch, next.role); } catch { next.team = null; }
      }
      if (ticket !== epoch || disposed) return;
      data = next;
      render();
    } catch {
      if (ticket !== epoch || disposed) return;
      data = null;
      root.innerHTML = `${banner}<main class="loading-screen">${brand}<h1>No hemos podido cargar tu espacio.</h1><p>Comprueba la conexión y vuelve a intentarlo.</p><button class="button primary" data-refresh>Volver a intentar</button><button class="button secondary" data-logout>Cerrar sesión</button></main>`;
    }
  }

  async function signIn(event) {
    event.preventDefault();
    if (actionBusy || logoutBusy) return;
    actionBusy = true;
    const form = event.currentTarget, button = form.querySelector('button'), status = form.querySelector('#login-message');
    button.disabled = true; button.textContent = 'Entrando…'; status.textContent = '';
    try {
      const { error } = await client.auth.signInWithPassword({ email: form.elements.email.value.trim(), password: form.elements.password.value });
      form.elements.password.value = '';
      if (error) throw error;
      ignoreSession = false;
      // onAuthStateChange also handles reloads and refreshes. No role from the form.
      await sync();
    } catch (error) { status.textContent = messageFor(error); }
    finally { actionBusy = false; button.disabled = false; button.innerHTML = `Entrar en mi espacio ${icon('arrow')}`; }
  }

  async function submitProfile(event) {
    event.preventDefault();
    if (actionBusy) return;
    const currentUser = user, ticket = epoch, form = event.currentTarget;
    const button = form.querySelector('button'), status = form.querySelector('#profile-message');
    actionBusy = true; button.disabled = true; status.textContent = '';
    try {
      await saveProfile(client, currentUser, form.elements.display_name.value, Boolean(data.profile));
      if (ticket !== epoch || disposed) return;
      await sync(); announce('Perfil guardado.');
    } catch (error) { if (ticket === epoch && !disposed) status.textContent = error instanceof Error && error.message.startsWith('Escribe un nombre') ? error.message : messageFor(error); }
    finally { actionBusy = false; button.disabled = false; }
  }

  async function onClick(event) {
    const target = event.target.closest('button, .brand');
    if (!target) return;
    if (target.classList.contains('brand')) { event.preventDefault(); view = 'overview'; render(); }
    if (target.dataset.view) { view = target.dataset.view; query = ''; render(); }
    if (target.hasAttribute('data-refresh')) await sync();
    if (target.dataset.teamPage !== undefined) { teamPage = Number(target.dataset.teamPage); await sync(); }
    if (target.hasAttribute('data-close-team')) root.querySelector('#team-confirm').close();
    if (target.dataset.teamAccept || target.dataset.teamRevoke) showTeamConfirmation(target);
    if (target.hasAttribute('data-logout')) {
      if (logoutBusy) return;
      logoutBusy = true; ignoreSession = true;
      ++epoch; user = null; data = null; view = 'overview'; query = ''; teamPage = 0; preferredRole = null; login();
      root.querySelector('#login-form button').disabled = true;
      try {
        const { error } = await client.auth.signOut({ scope: 'local' });
        if (error) login('No se pudo confirmar el cierre de sesión. Vuelve a intentarlo antes de dejar este dispositivo.', true);
      } catch { login('No se pudo confirmar el cierre de sesión. Comprueba tu conexión.', true); }
      finally { logoutBusy = false; const submit = root.querySelector('#login-form button'); if (submit) submit.disabled = false; }
    }
    if (target.dataset.athlete) {
      const athlete = data?.athletes.find(a => a.user_id === target.dataset.athlete);
      if (!athlete) return;
      root.querySelector('#athlete-detail-content').innerHTML = `<span class="avatar">${esc(initials(athlete.display_name))}</span><span class="eyebrow">DEPORTISTA DE TU EQUIPO</span><h2>${esc(athlete.display_name)}</h2><span class="status active">Vinculación activa</span><p>La planificación de sesiones y el seguimiento deportivo se habilitarán en una siguiente fase.</p>`;
      root.querySelector('#athlete-detail').showModal();
    }
    if (target.hasAttribute('data-close-dialog')) root.querySelector('#athlete-detail').close();
  }

  function showTeamConfirmation(target) {
    const accepting = Boolean(target.dataset.teamAccept);
    const coachId = target.dataset.teamAccept || target.dataset.teamRevoke;
    const athleteId = accepting ? user.id : target.dataset.athleteId;
    const relationship = data?.team?.links.find(r => r.coach_id === coachId && r.athlete_id === athleteId);
    if (!relationship) return;
    root.querySelector('#team-confirm-content').innerHTML = `<span class="eyebrow">TU EQUIPO, TU DECISIÓN</span><h2>${accepting ? 'Aceptar entrenador' : 'Desvincular del equipo'}</h2><p>${accepting ? `Vas a aceptar a ${esc(relationship.coach_name || 'este entrenador')}. Al aceptar podrá consultar tu perfil deportivo, resúmenes de actividades y planificación. Las métricas de rendimiento y las curvas requieren permisos adicionales que puedes revisar en Garmin. El archivo completo de tu cuenta y el GPS permanecen privados.` : 'La vinculación dejará de estar activa. Para retomarla será necesaria una nueva propuesta y aceptación.'}</p><form data-team-form="${accepting ? 'accept' : 'revoke'}"><input type="hidden" name="coachId" value="${esc(coachId)}">${accepting ? '<label class="consent-check"><input type="checkbox" name="consent" required> Autorizo el acceso a mi perfil deportivo, resúmenes de actividades y planificación.</label>' : `<input type="hidden" name="athleteId" value="${esc(athleteId)}">`}<button class="button primary" type="submit">${accepting ? 'Aceptar vinculación' : 'Confirmar desvinculación'}</button><p class="form-message" data-team-error role="alert"></p></form>`;
    root.querySelector('#team-confirm').showModal();
  }

  async function onTeamSubmit(event) {
    const form = event.target.closest('[data-team-form]');
    if (!form) return;
    event.preventDefault();
    if (teamBusy || !user) return;
    const ticket = epoch, button = form.querySelector('button[type="submit"]');
    const fields = new form.ownerDocument.defaultView.FormData(form);
    const body = { ...Object.fromEntries(fields), action: form.dataset.teamForm };
    if (body.action === 'accept') body.consent = fields.get('consent') === 'on';
    teamBusy = true; button.disabled = true;
    try {
      await teamRequest(client, body, teamPage);
      if (ticket !== epoch || disposed || ignoreSession) return;
      await sync(); announce('Cambio guardado.');
    } catch (error) {
      if (ticket === epoch && !disposed) {
        const slot = form.querySelector('[data-team-error]') || root.querySelector('#team-message');
        if (slot) slot.textContent = error.message || 'No se ha podido guardar el cambio.';
      }
    } finally { teamBusy = false; button.disabled = false; }
  }

  function onWorkspaceChange(event) {
    if ((event.target.id !== 'workspace-role' && !event.target.hasAttribute('data-mobile-role')) || !data?.roles.includes(event.target.value)) return;
    preferredRole = event.target.value; teamPage = 0; view = 'overview'; query = '';
    void sync();
  }

  async function updateNewsBadge(){const uid=user?.id;if(!uid)return;try{const count=await unreadNews(client,uid);if(user?.id!==uid||disposed)return;const badge=root.querySelector('[data-news-count]');if(badge){badge.hidden=!count;badge.textContent=count>99?'99+':String(count);}}catch{}}
  const onPushMessage=e=>{if(e.data?.type==='ASTURPOWER_NEWS')void updateNewsBadge();if(e.data?.type==='ASTURPOWER_OPEN_NEWS'&&user&&!root.querySelector('[data-garmin-import-running="true"]'))navigateHub('news');};
  root.ownerDocument.defaultView.navigator.serviceWorker?.addEventListener('message',onPushMessage);
  root.addEventListener('click', onClick);
  root.addEventListener('submit', onTeamSubmit);
  root.addEventListener('change', onWorkspaceChange);
  const importingHistory = () => Boolean(root.querySelector('[data-garmin-import-running="true"]'));
  const { data: authListener } = client.auth.onAuthStateChange((event, session) => {
    if (disposed) return;
    if (event === 'SIGNED_OUT' || (event === 'INITIAL_SESSION' && !session)) {
      ++epoch; user = null; data = null; query = ''; view = 'overview'; preferredRole = null; login();
    } else if (['SIGNED_IN', 'INITIAL_SESSION', 'TOKEN_REFRESHED', 'USER_UPDATED'].includes(event)) {
      // A routine same-account refresh must not destroy the running importer.
      // Sign-out, account changes and explicit user updates still refresh immediately.
      if (!ignoreSession && user?.id && session?.user?.id === user.id &&
          ['SIGNED_IN', 'TOKEN_REFRESHED'].includes(event) && (importingHistory()||['profile','weight','zones-hr','zones-power','news'].includes(view))) {
        user = session.user;
        return;
      }
      // Auth callbacks must remain synchronous; SDK requests run outside their lock.
      setTimeout(() => { if (!disposed) void sync(); }, 0);
    }
  });
  const onVisibility = () => { if (root.ownerDocument.visibilityState === 'visible' && user && !importingHistory() && !['profile','weight','zones-hr','zones-power','news'].includes(view)) void sync(); };
  root.ownerDocument.addEventListener('visibilitychange', onVisibility);
  loading();
  // Makes startup independent of whether the SDK already emitted INITIAL_SESSION.
  void sync();
  return () => { cleanupHub();root.ownerDocument.defaultView.navigator.serviceWorker?.removeEventListener('message',onPushMessage);disposed = true; ++epoch; authListener.subscription.unsubscribe(); root.removeEventListener('click', onClick); root.removeEventListener('submit', onTeamSubmit); root.removeEventListener('change', onWorkspaceChange); root.ownerDocument.removeEventListener('visibilitychange', onVisibility); root.replaceChildren(); };
}

function initials(name) {
  return name.trim().split(/\s+/).slice(0, 2).map(part => [...part][0] || '').join('').toLocaleUpperCase('es');
}

