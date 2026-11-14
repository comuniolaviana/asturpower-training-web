import test from 'node:test';
import assert from 'node:assert/strict';
import {coachSessionEssentials} from '../app/src/coach-session-essentials.js';

const get=(result,key)=>result.entries.find(entry=>entry.key===key);
test('el entrenador ve FTP fechado, NP, IF, TSS, trabajo real en kJ, cadencia y pulso',()=>{
 const summary=coachSessionEssentials({
  activity:{avg_power_watts:200,avg_heart_rate:135},
  metric:{normalized_power_watts:220,np_method:'device',intensity_factor:0.88,tss:77.44,
   if_source:'historical_ftp',tss_source:'historical_ftp',device_tss:77.44,device_intensity_factor:0.88,device_ftp_watts:250},
  physiology:{ftp:250,effective_date:'2026-01-01'},
  series:{sessions:[{totalWork:720000,avgCadence:84,avgHeartRate:133}]}
 });
 assert.equal(get(summary,'ftp').value,250);
 assert.match(get(summary,'ftp').source,/2026-01-01/);
 assert.equal(get(summary,'np').value,220);
 assert.equal(get(summary,'if').value,0.88);
 assert.equal(get(summary,'tss').value,77.44);
 assert.equal(get(summary,'kj').value,720);
 assert.equal(get(summary,'cadence').value,84);
 assert.equal(get(summary,'heartRate').value,135);
 assert.equal(summary.deviation,null);
});
test('sin series o sin FTP no inventa kJ, cadencia ni umbral histórico',()=>{
 const summary=coachSessionEssentials({activity:{avg_heart_rate:140},metric:{normalized_power_watts:160}});
 assert.equal(get(summary,'ftp').value,null);
 assert.equal(get(summary,'kj').value,null);
 assert.equal(get(summary,'cadence').value,null);
 assert.equal(get(summary,'np').value,160);
 assert.equal(get(summary,'heartRate').value,140);
 assert.equal(summary.originalGarmin.tss,null);
});
test('conserva el TSS original de Garmin y avisa de una discrepancia significativa',()=>{
 const summary=coachSessionEssentials({metric:{tss:90,tss_source:'historical_ftp',device_tss:70,device_intensity_factor:0.8}});
 assert.equal(get(summary,'tss').value,90);
 assert.equal(summary.originalGarmin.tss,70);
 assert.match(summary.deviation,/difiere/);
});
test('si el FIT solo trae IF y TSS del dispositivo se muestran con su fuente sin usar un FTP moderno',()=>{
 const summary=coachSessionEssentials({series:{sessions:[{intensityFactor:0.75,trainingStressScore:56,totalWork:0,avgCadence:0}]}});
 assert.equal(get(summary,'if').value,0.75);
 assert.equal(get(summary,'tss').value,56);
 assert.match(get(summary,'tss').source,/Garmin/);
 assert.equal(get(summary,'kj').value,0);
 assert.equal(get(summary,'cadence').value,0);
 assert.equal(get(summary,'ftp').value,null);
});

test('índice de variabilidad e intensidad relativa al peso: solo con potencia y peso fechados',()=>{
 const report=coachSessionEssentials({activity:{avg_power_watts:200},metric:{normalized_power_watts:220},physiology:{weight_kg:70,effective_date:'2026-01-01'}});
 assert.equal(get(report,'vi').value,1.1);
 assert.equal(get(report,'wkg').value,2.86);
 assert.match(get(report,'wkg').source,/histórica/);
 const noWeight=coachSessionEssentials({activity:{avg_power_watts:200},metric:{normalized_power_watts:220}});
 assert.equal(get(noWeight,'vi').value,1.1);
 assert.equal(get(noWeight,'wkg').value,null);
 const noMean=coachSessionEssentials({metric:{normalized_power_watts:220},physiology:{weight_kg:70}});
 assert.equal(get(noMean,'vi').value,null);
 assert.equal(get(noMean,'wkg').value,null);
});
