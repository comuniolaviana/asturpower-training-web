import test from 'node:test';
import assert from 'node:assert/strict';
import {auditCoachActivity} from '../app/src/coach-performance-audit.js';

const activity={sport:'cycling',started_at:'2026-11-10T08:00:00Z'};
const metric={normalized_power_watts:200,ftp_watts:250,intensity_factor:.8,tss:64,
 if_source:'historical_ftp',tss_source:'historical_ftp',duration_seconds:3600,device_tss:64,
 np_method:'records_1s'};
const physiology={ftp:250,effective_date:'2026-01-01'};

test('motor completo: indica base de contraste, no afirma igualdad con TrainingPeaks',()=>{
 const report=auditCoachActivity({activity,metric,physiology,seriesAvailable:true,seriesAllowed:true});
 assert.equal(report.status,'base_disponible');
 assert.equal(report.hasNp,true);assert.equal(report.hasTss,true);
 assert.deepEqual(report.issues,[]);
 assert.equal(report.comparableWithTrainingPeaks,false);
});
test('sin FIT no convierte ausencia en descanso ni esconde las actividades',()=>{
 const report=auditCoachActivity({activity,metric:null,seriesAllowed:true});
 assert.equal(report.status,'incompleta');assert.equal(report.hasTss,false);
 assert.match(report.issues.join(' '),/FIT/);
});
test('sin TSS o NP se muestra qué falta y se mantiene como pendiente',()=>{
 const report=auditCoachActivity({activity,metric:{intensity_factor:null,tss:null},seriesAvailable:true,seriesAllowed:true});
 assert.equal(report.status,'incompleta');
 assert.match(report.issues.join(' '),/NP/);
 assert.match(report.issues.join(' '),/TSS/);
 assert.match(report.issues.join(' '),/IF/);
});
test('diferencias superiores a 5 TSS o 5% respecto a Garmin exigen revisión',()=>{
 const report=auditCoachActivity({activity,metric:{...metric,tss:85},physiology,seriesAvailable:true,seriesAllowed:true});
 assert.equal(report.status,'revisar');
 assert.match(report.issues.join(' '),/Garmin/);
});
test('con Garmin original y sin FTP fechado no inventa FTP pero mantiene la carga conocida',()=>{
 const report=auditCoachActivity({activity,metric:{...metric,intensity_factor:.8,if_source:'garmin_recorded',tss_source:'garmin_recorded'},
  seriesAvailable:true,seriesAllowed:true});
 assert.equal(report.status,'base_disponible');
 assert.match(report.notes.join(' '),/FTP histórico/);
});
test('sin permiso de curvas no señala fallo técnico; con permiso sin archivo sí',()=>{
 const noAccess=auditCoachActivity({activity,metric,physiology,seriesAllowed:false});
 assert.equal(noAccess.status,'base_disponible');
 assert.match(noAccess.notes.join(' '),/permiso/);
 const noSeries=auditCoachActivity({activity,metric,physiology,seriesAvailable:false,seriesAllowed:true});
 assert.equal(noSeries.status,'incompleta');
 assert.match(noSeries.issues.join(' '),/series/);
});
test('detecta IF incoherente con NP/FTP y TSS calculado incoherente con IF/duración',()=>{
 const report=auditCoachActivity({activity,metric:{...metric,intensity_factor:.96,tss:85,device_tss:null},physiology,seriesAllowed:true,seriesAvailable:true});
 assert.equal(report.status,'revisar');
 assert.match(report.issues.join(' '),/NP\/FTP/);
 assert.match(report.issues.join(' '),/duración y el IF/);
});
test('gimnasio sin TSS no se contabiliza como TSS cero ni se le aplica ciclismo',()=>{
 const report=auditCoachActivity({activity:{sport:'strength'},metric:{tss:null},seriesAllowed:false});
 assert.equal(report.status,'base_disponible');
 assert.equal(report.hasTss,false);
 assert.match(report.notes.join(' '),/modalidad/);
});

test('sesiones cortas con NP calculada llevan aviso de interpretación',()=>{
 const audit=auditCoachActivity({activity,metric:{...metric,duration_seconds:600,tss:10.667,device_tss:null},physiology,seriesAvailable:true,seriesAllowed:true});
 assert.match(audit.notes.join(' '),/menos de 20 minutos/);
});
