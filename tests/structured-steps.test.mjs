import test from 'node:test';
import assert from 'node:assert/strict';
import { validateSteps, stepsTotalSeconds, describeStep } from '../app/src/structured-steps.js';
const warmup={phase:'warmup',duration_seconds:600,target_type:'ftp_pct',low:55,high:70};
const work={phase:'work',duration_seconds:180,target_type:'watts',low:220,high:240};
const recover={phase:'recovery',duration_seconds:90,target_type:'free',low:null,high:null};
test('normaliza estructura y calcula segundos',()=>{
 const blocks=validateSteps([warmup,work,recover]);
 assert.equal(blocks.length,3);
 assert.equal(stepsTotalSeconds(blocks),870);
 assert.match(describeStep(warmup),/Calentamiento/);
});
test('sesión simple no genera estructura',()=>{
 assert.equal(validateSteps([]),null);assert.equal(validateSteps(null),null);
});
test('bloques rechazados si duración o rango fuera de límites',()=>{
 assert.throws(()=>validateSteps([{...work,duration_seconds:12}]),/duración/);
 assert.throws(()=>validateSteps([{...work,low:350,high:200}]),/rango/);
 assert.throws(()=>validateSteps([{...warmup,target_type:'ftp_pct',low:10,high:400}]),/rango/);
});
test('se rechaza objetivo sin completar',()=>{
 assert.throws(()=>validateSteps([{...work,low:null}]),/Completa/);
});
test('se rechazan más de treinta pasos',()=>{
 assert.throws(()=>validateSteps(Array.from({length:31},()=>({...recover}))),/30 bloques/);
});
test('se rechaza una sesión superior a 24 horas',()=>{
 assert.throws(()=>validateSteps(Array.from({length:5},()=>({...recover,duration_seconds:21600}))),/24 horas/);
});
