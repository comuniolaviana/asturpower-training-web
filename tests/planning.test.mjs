
import test from 'node:test';
import assert from 'node:assert/strict';
import {calendarDays,isoDate,validateWorkout} from '../app/src/planning.js';
test('noviembre 2026 empieza en domingo y el calendario el lunes',()=>{
  const days=calendarDays(2026,10);
  assert.equal(days[0],null);
  assert.equal(days[6],'2026-11-01');
  assert.equal(days[7],'2026-11-02');
});
test('la fecha del entrenamiento se mantiene local',()=>{
  assert.equal(isoDate(new Date(2026,10,3,23,50)),'2026-11-03');
});
test('valida sesiones de ciclismo y fecha real',()=>{
  const workout={title:'Rodaje Z2',duration_minutes:'90',scheduled_date:'2026-11-09',sport:'cycling',intensity_target:'Z2',coach_notes:'Suave'};
  assert.equal(validateWorkout(workout).duration_minutes,90);
  assert.throws(()=>validateWorkout({...workout,scheduled_date:'2026-02-30'}),/fecha/);
  assert.throws(()=>validateWorkout({...workout,duration_minutes:'0'}),/duración/);
  assert.throws(()=>validateWorkout({...workout,title:''}),/título/);
});
