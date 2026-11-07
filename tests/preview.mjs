import { mountApp } from '../app/src/ui.js';
import { fakeClient } from './fake-client.mjs';
import '../app/src/style.css';
import '../app/src/garmin-connect.css';
import '../app/src/planning.css';
import '../app/src/athlete-hub.css';
import '../app/src/performance.css';
import '../app/src/pmc.css';
import {addDays} from '../app/src/performance.js';
const scenario = new URLSearchParams(location.search).get('case');
const options = scenario === 'login' ? { signedIn: false }
  : scenario === 'athlete' ? { role: 'athlete', name: 'Lucía Ejemplo' }
  : scenario === 'pending' ? { role: null }
  : scenario === 'onboarding' ? { profile: false, role: null }
  : scenario === 'error' ? { fail: true } : {};
if (scenario === 'dual') options.roles = ['coach', 'athlete'];
const client = fakeClient(options);
if(scenario==='pmc'){
 const id=client.state.tables.coach_athletes[0].athlete_id,coach=client.state.user.id,today='2026-11-07';
 client.state.tables.athlete_coach_fit_sharing=[{athlete_id:id,coach_id:coach,series_enabled:false}];
 client.state.tables.activities=Array.from({length:365},(_,i)=>({id:'qa-'+i,athlete_id:id,started_at:addDays(today,i-364)+'T10:00:00Z',sport:'cycling',duration_seconds:3600,title:'Salida de prueba '+i}));
 client.state.tables.garmin_fit_analysis=client.state.tables.activities.map((a,i)=>({activity_id:a.id,athlete_id:id,sport:'cycling',fit_started_at:a.started_at,device_tss:i%7===0?null:45+(i%5)*15}));
 client.state.tables.planned_workouts=Array.from({length:21},(_,i)=>({id:'qa-plan-'+i,athlete_id:id,coach_id:coach,status:'planned',scheduled_date:addDays(today,i+1),estimated_tss:i%4===0?0:60+(i%3)*25,title:i%4===0?'Descanso de prueba':'Sesión de prueba',sport:'cycling'}));
}
if (scenario === 'dual') client.state.tables.coach_athletes.push({ coach_id: '44444444-4444-4444-8444-444444444444', athlete_id: client.state.user.id, status: 'active' });
if(scenario==='athlete'){client.state.tables.app_notifications=[{id:'demo-1',recipient_id:client.state.user.id,kind:'workout',event_date:'2026-11-07',title:'Nuevo entrenamiento',message:'Resistencia · 90 minutos',read_at:null},{id:'demo-2',recipient_id:client.state.user.id,kind:'activity',event_date:'2026-11-06',title:'Actividad sincronizada',message:'Salida de carretera',read_at:null},{id:'demo-3',recipient_id:client.state.user.id,kind:'activity',event_date:'2026-11-05',title:'Actividad sincronizada',message:'Sesión de rodillo',read_at:'2026-11-05'}];}
mountApp(document.querySelector('#app'), client, { fixture: true,teamRequest:async()=>null });
