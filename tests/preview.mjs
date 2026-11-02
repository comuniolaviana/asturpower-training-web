import { mountApp } from '../app/src/ui.js';
import { fakeClient } from './fake-client.mjs';
import '../app/src/style.css';
const scenario = new URLSearchParams(location.search).get('case');
const options = scenario === 'login' ? { signedIn: false }
  : scenario === 'athlete' ? { role: 'athlete', name: 'Lucía Ejemplo' }
  : scenario === 'pending' ? { role: null }
  : scenario === 'onboarding' ? { profile: false, role: null }
  : scenario === 'error' ? { fail: true } : {};
mountApp(document.querySelector('#app'), fakeClient(options), { fixture: true });
