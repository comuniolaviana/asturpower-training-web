import test from 'node:test';
import assert from 'node:assert/strict';
import {compareToTrainingPeaks} from '../app/src/coach-tp-comparison.js';

const summary={entries:[{key:'np',value:220},{key:'if',value:.88},{key:'tss',value:77.44}]};
test('comparación manual dentro de tolerancias explícitas',()=>{
 const result=compareToTrainingPeaks(summary,{np:221,if:.89,tss:79});
 assert.deepEqual(result.map(r=>r.state),['aproximado','aproximado','aproximado']);
});
test('diferencias grandes se marcan, no se reemplazan los cálculos',()=>{
 const result=compareToTrainingPeaks(summary,{np:200,if:.75,tss:55});
 assert.deepEqual(result.map(r=>r.state),['diferente','diferente','diferente']);
 assert.equal(result[0].delta,20);
 assert.equal(summary.entries[0].value,220);
});
test('sin referencia o sin TSS no inventa coincidencia',()=>{
 const a=compareToTrainingPeaks(summary,{np:220});
 assert.equal(a[1].state,'sin_referencia');
 const b=compareToTrainingPeaks({entries:[{key:'np',value:220}]},{np:220,if:.89,tss:79});
 assert.equal(b[1].state,'sin_dato');assert.equal(b[2].state,'sin_dato');
});
test('TSS cero es una referencia válida, pero no equivale a TSS ausente',()=>{
 const a=compareToTrainingPeaks({entries:[{key:'tss',value:0}]},{tss:0});
 assert.equal(a[2].state,'aproximado');
 const b=compareToTrainingPeaks({entries:[{key:'tss',value:null}]},{tss:0});
 assert.equal(b[2].state,'sin_dato');
});
