import { loadDashboard, saveProfile, messageFor, ROLE_LABELS, STATUS_LABELS } from './data.js';

const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const glyphs = {
  home: '<path d="m3 10 9-7 9 7v10H3z"/><path d="M9 20v-7h6v7"/>',
  people: '<circle cx="9" cy="7" r="3"/><path d="M3 21v-3a6 6 0 0 1 12 0v3M16 4a3 3 0 0 1 0 6M18 14a5 5 0 0 1 3 4v3"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  arrow: '<path d="M5 12h14m-6-6 6 6-6 6"/>',
  lock: '<rect x="5" y="10" width="14" height="11" rx="3"/><path d="M8 10V7a4 4 0 0 1 8 0M12 14v3"/>',
  refresh: '<path d="M20 8a8 8 0 1 0 0 8M20 3v5h-5"/>',
  logout: '<path d="M10 4H4v16h6M9 12h12m-5-5 5 5-5 5"/>',
};
const icon = name => `<svg viewBox="0 0 24 24" aria-hidden="true">${glyphs[name] || glyphs.home}</svg>`;
const brand = `<a class="brand" href="#" aria-label="AsturPower Training, inicio"><span class="brand-symbol">ϟ</span><span>ASTUR<b>POWER</b><small>TRAINING</small></span></a>`;
const contact = 'mailto:AsturPower.Training@gmail.com';
const empty = (title, text, symbol = 'people') => `<div class="empty-state"><span class="empty-icon">${icon(symbol)}</span><h3>${title}</h3><p>${text}</p></div>`;

export function showUnavailable(root) {
  root.innerHTML = `<main class="unavailable">${brand}<div class="unavailable-card">${icon('lock')}<span class="eyebrow">ÁREA PRIVADA</span><h1>Estamos preparando<br>tu espacio.</h1><p>El acceso de pruebas aún no está disponible. Puedes contactar con el equipo para conocer el siguiente paso.</p><a class="button primary" href="${contact}">Contactar con AsturPower ${icon('arrow')}</a></div><span class="subtle">AsturPower Training · Entrenar con propósito</span></main>`;
}

export function mountApp(root, client, { fixture = false } = {}) {
  let user = null, data = null, view = 'overview', epoch = 0, disposed = false, query = '';
  let actionBusy = false, logoutBusy = false, ignoreSession = false;
  const banner = fixture ? '<div class="fixture-banner">VISTA DE PRUEBA · DATOS FICTICIOS</div>' : '';

  function login(message = '', retryLogout = false) {
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
    const active = data.relationships.filter(r => r.status === 'active').length;
    const pending = data.relationships.filter(r => r.status === 'pending').length;
    return `<section class="welcome-card"><div><span class="eyebrow">UN EQUIPO, UN MISMO RUMBO</span><h2>${data.role === 'coach' ? 'Conoce a tu equipo.<br>Acompaña cada paso.' : 'Tu preparación,<br>en buena compañía.'}</h2><p>${data.role === 'coach' ? 'Aquí encontrarás a las personas que entrenan contigo y el estado de sus vinculaciones.' : 'Este es tu espacio para mantener tu perfil y consultar el estado de tus vinculaciones.'}</p></div><span class="welcome-mark" aria-hidden="true">ϟ</span></section><div class="summary-grid"><article class="summary-card"><span>${icon('people')} Vinculaciones activas</span><strong>${active.toString().padStart(2, '0')}</strong><small>${data.role === 'coach' ? 'Deportistas vinculados a ti' : 'Entrenadores vinculados a ti'}</small></article><article class="summary-card"><span>${icon('lock')} Pendientes de activar</span><strong>${pending.toString().padStart(2, '0')}</strong><small>El equipo revisará cada vinculación</small></article><article class="summary-card connection-card"><span>GARMIN CONNECT</span><strong>Próximamente</strong><small>La conexión todavía no está disponible</small></article></div>${data.role === 'coach' ? teamContent() : `<section class="panel"><div class="panel-heading"><h2>Mis vinculaciones</h2><span class="count-pill">${data.relationships.length}</span></div>${data.relationships.length ? `<ul class="relationship-list">${data.relationships.map(r => `<li><span>${icon('people')} Vinculación con entrenador</span><span class="status ${esc(r.status)}">${esc(STATUS_LABELS[r.status] || 'Sin confirmar')}</span></li>`).join('')}</ul><p class="subtle">Los detalles del entrenador se habilitarán en una siguiente fase.</p>` : empty('Aún no tienes vinculaciones.', 'Cuando se active tu relación con un entrenador, aparecerá en este espacio.')}</section>`}`;
  }

  function render() {
    if (!user || !data) return;
    const roleLabel = ROLE_LABELS[data.role] || 'Acceso pendiente';
    const name = data.profile?.display_name || 'Tu espacio';
    const currentTitle = view === 'profile' ? 'Mi perfil' : view === 'team' ? 'Mis deportistas' : 'Vista general';
    const content = !data.profile ? profileForm(true) : view === 'profile' ? profileForm() : !data.role
      ? `<section class="panel pending-panel">${icon('lock')}<span class="eyebrow">PERFIL PREPARADO</span><h2>El siguiente paso es con tu equipo.</h2><p>Tu cuenta está pendiente de asignación de acceso. Contacta con AsturPower para habilitar tu espacio de entrenador o deportista.</p><a class="button primary" href="${contact}">Contactar con el equipo ${icon('arrow')}</a></section>`
      : data.role === 'admin' ? `<section class="panel pending-panel">${icon('people')}<h2>Tu acceso de administración está identificado.</h2><p>La gestión de altas y vinculaciones está pendiente de habilitación. Tu perfil ya está disponible.</p><button class="button primary" data-view="profile">Revisar mi perfil ${icon('arrow')}</button></section>`
      : view === 'team' && data.role === 'coach' ? teamContent() : overview();
    root.innerHTML = `${banner}<div class="app-shell"><aside class="sidebar">${brand}<div class="workspace-label">MI ESPACIO</div><nav aria-label="Navegación principal">${navItem('overview', 'Vista general', 'home')}${data.role === 'coach' ? navItem('team', 'Mis deportistas', 'people') : ''}${navItem('profile', 'Mi perfil', 'user')}</nav><div class="sidebar-bottom"><div class="sidebar-note"><span class="mini-dot"></span> Entorno de pruebas<p>Paso a paso, hacia<br>tu mejor versión.</p></div><button class="logout" data-logout>${icon('logout')} Cerrar sesión</button></div></aside><div class="workspace"><header class="topbar"><span>Mi espacio <i>/</i> <strong>${currentTitle}</strong></span><span class="identity"><span class="identity-text">${esc(name)}<small>${roleLabel}</small></span><span class="avatar small">${esc(initials(name))}</span></span></header><main id="main-content"><div class="page-heading"><div><span class="eyebrow">ASTURPOWER TRAINING</span><h1>${view === 'overview' ? `Hola, ${esc(name)}<span class="lime-period">.</span>` : currentTitle}</h1><p>${view === 'profile' ? 'Lo esencial para que tu equipo te conozca.' : 'Todo empieza por las personas que te acompañan.'}</p></div><button class="button secondary" data-refresh>${icon('refresh')} Actualizar</button></div><p id="notice" class="notice" role="status" aria-live="polite"></p>${content}<footer class="workspace-footer"><span>Entrenar con propósito.</span><span>AsturPower Training</span></footer></main></div></div><dialog id="athlete-detail"><button class="dialog-close" data-close-dialog aria-label="Cerrar ficha">×</button><div id="athlete-detail-content"></div></dialog>`;
    root.querySelector('#profile-form')?.addEventListener('submit', submitProfile);
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
      const next = await loadDashboard(client, user);
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
    if (target.hasAttribute('data-logout')) {
      if (logoutBusy) return;
      logoutBusy = true; ignoreSession = true;
      ++epoch; user = null; data = null; view = 'overview'; query = ''; login();
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

  root.addEventListener('click', onClick);
  const { data: authListener } = client.auth.onAuthStateChange((event, session) => {
    if (disposed) return;
    if (event === 'SIGNED_OUT' || (event === 'INITIAL_SESSION' && !session)) {
      ++epoch; user = null; data = null; query = ''; view = 'overview'; login();
    } else if (['SIGNED_IN', 'INITIAL_SESSION', 'TOKEN_REFRESHED', 'USER_UPDATED'].includes(event)) {
      // Auth callbacks must remain synchronous; SDK requests run outside their lock.
      setTimeout(() => { if (!disposed) void sync(); }, 0);
    }
  });
  const onVisibility = () => { if (root.ownerDocument.visibilityState === 'visible' && user) void sync(); };
  root.ownerDocument.addEventListener('visibilitychange', onVisibility);
  loading();
  // Makes startup independent of whether the SDK already emitted INITIAL_SESSION.
  void sync();
  return () => { disposed = true; ++epoch; authListener.subscription.unsubscribe(); root.removeEventListener('click', onClick); root.ownerDocument.removeEventListener('visibilitychange', onVisibility); root.replaceChildren(); };
}

function initials(name) {
  return name.trim().split(/\s+/).slice(0, 2).map(part => [...part][0] || '').join('').toLocaleUpperCase('es');
}
