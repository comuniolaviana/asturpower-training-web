import test from 'node:test';
import assert from 'node:assert/strict';
import {sportsSeriesReservationMessage} from '../app/src/garmin-sports-series.js';

test('presupuesto deportivo agotado: indica 800 MiB y evita repetir importaciones inútiles',()=>{
 const message=sportsSeriesReservationMessage({code:'54000',message:'series_storage_budget_exceeded'});
 assert.match(message,/800 MiB/);
 assert.match(message,/No repitas la importación/);
 assert.match(message,/no se han borrado/);
});
test('no confunde un conflicto de serie existente con falta de capacidad',()=>{
 assert.match(sportsSeriesReservationMessage({code:'P0001',message:'series_manifest_conflict'}),/no se ha sobrescrito/i);
});
test('diferencia falta de FIT autorizado y formato inválido',()=>{
 assert.match(sportsSeriesReservationMessage({message:'owned_fit_required'}),/FIT vinculado/);
 assert.match(sportsSeriesReservationMessage({message:'invalid_series_manifest'}),/límites de seguridad/);
});
test('errores desconocidos se muestran sin revelar mensajes internos',()=>{
 const message=sportsSeriesReservationMessage({code:'XX',message:'token PRIVADO'});
 assert.doesNotMatch(message,/PRIVADO/);
 assert.match(message,/diagnóstico/);
});
