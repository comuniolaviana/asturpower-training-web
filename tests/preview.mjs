import { mountApp } from '../app/src/ui.js';
import { fakeClient } from './fake-client.mjs';
import '../app/src/style.css';
import '../app/src/garmin-connect.css';
import '../app/src/planning.css';
const scenario = new URLSearchParams(location.search).get('case');
const options = scenario === 'login' ? { signedIn: false }
  : scenario === 'athlete' ? { role: 'athlete', name: 'Lucía Ejemplo' }
  : scenario === 'pending' ? { role: null }
  : scenario === 'onboarding' ? { profile: false, role: null }
  : scenario === 'error' ? { fail: true } : {};
if (scenario === 'dual') options.roles = ['coach', 'athlete'];
const client = fakeClient(options);
if (scenario === 'dual') client.state.tables.coach_athletes.push({ coach_id: '44444444-4444-4444-8444-444444444444', athlete_id: client.state.user.id, status: 'active' });
mountApp(document.querySelector('#app'), client, { fixture: true });

