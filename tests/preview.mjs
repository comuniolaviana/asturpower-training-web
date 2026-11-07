import { mountApp } from '../app/src/ui.js';
import { fakeClient } from './fake-client.mjs';
import '../app/src/style.css';
import '../app/src/garmin-connect.css';
import '../app/src/planning.css';
import '../app/src/athlete-hub.css';
const scenario = new URLSearchParams(location.search).get('case');
const options = scenario === 'login' ? { signedIn: false }
  : scenario === 'athlete' ? { role: 'athlete', name: 'Lucía Ejemplo' }
  : scenario === 'pending' ? { role: null }
  : scenario === 'onboarding' ? { profile: false, role: null }
  : scenario === 'error' ? { fail: true } : {};
if (scenario === 'dual') options.roles = ['coach', 'athlete'];
const client = fakeClient(options);
if (scenario === 'dual') client.state.tables.coach_athletes.push({ coach_id: '44444444-4444-4444-8444-444444444444', athlete_id: client.state.user.id, status: 'active' });
if(scenario==='athlete'){client.state.tables.app_notifications=[{id:'demo-1',recipient_id:client.state.user.id,kind:'workout',event_date:'2026-11-07',title:'Nuevo entrenamiento',message:'Resistencia · 90 minutos',read_at:null},{id:'demo-2',recipient_id:client.state.user.id,kind:'activity',event_date:'2026-11-06',title:'Actividad sincronizada',message:'Salida de carretera',read_at:null},{id:'demo-3',recipient_id:client.state.user.id,kind:'activity',event_date:'2026-11-05',title:'Actividad sincronizada',message:'Sesión de rodillo',read_at:'2026-11-05'}];}
mountApp(document.querySelector('#app'), client, { fixture: true,teamRequest:async()=>null });
