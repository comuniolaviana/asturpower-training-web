
import test from 'node:test';
import assert from 'node:assert/strict';
import {calendarDays,isoDate,validateWorkout,updatePlannedWorkout,deletePlannedWorkout} from '../app/src/planning.js';
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

function mockWorkoutClient(rows=[{id:'w1',coach_id:'coach1'}],error=null){
 const calls=[];
 return {
  calls,
  from(table){
   assert.equal(table,'planned_workouts');
   let operation, payload, filters=[];
   const query={
    update(value){operation='update';payload=value;return query;},
    delete(){operation='delete';return query;},
    eq(key,value){filters.push([key,value]);return query;},
    select(){return query;},
    single(){return Promise.resolve({data:rows.filter(row=>filters.every(([key,value])=>row[key]===value))[0]||null,error});},
    then(resolve){resolve({data:rows.filter(row=>filters.every(([key,value])=>row[key]===value)),error});}
   };
   calls.push({get operation(){return operation;},get payload(){return payload;},filters});
   return query;
  }
 };
}
const exampleWorkout={title:'Rodaje Z2',duration_minutes:90,scheduled_date:'2026-11-09',sport:'cycling',intensity_target:'Z2',coach_notes:'Suave'};
test('edición valida campos y limita cambio a id y coach_id',async()=>{
 const client=mockWorkoutClient();
 const saved=await updatePlannedWorkout(client,'coach1','w1',exampleWorkout);
 assert.equal(saved.id,'w1');
 assert.equal(client.calls[0].operation,'update');
 assert.deepEqual(client.calls[0].filters,[['id','w1'],['coach_id','coach1']]);
 assert.equal(client.calls[0].payload.title,'Rodaje Z2');
 assert.equal(Object.hasOwn(client.calls[0].payload,'athlete_id'),false);
});
test('edición devuelve error si no encontró registro autorizado',async()=>{
 const client=mockWorkoutClient();
 await assert.rejects(()=>updatePlannedWorkout(client,'other','w1',exampleWorkout),/No se ha podido/);
});
test('borrado limita cambio a id y coach_id y confirma una fila',async()=>{
 const client=mockWorkoutClient();
 assert.deepEqual(await deletePlannedWorkout(client,'coach1','w1'),{id:'w1',coach_id:'coach1'});
 assert.equal(client.calls[0].operation,'delete');
 assert.deepEqual(client.calls[0].filters,[['id','w1'],['coach_id','coach1']]);
});
test('borrado da error cuando no hay sesión autorizada',async()=>{
 const client=mockWorkoutClient();
 await assert.rejects(()=>deletePlannedWorkout(client,'other','w1'),/No se ha podido/);
});
