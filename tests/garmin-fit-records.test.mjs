import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeFitRecordMessages } from '../netlify/lib/garmin-fit-records.mjs';

const at = seconds => new Date(Date.UTC(2026, 10, 5, 10, 0, seconds));

test('conserva las mediciones válidas y no almacena GPS', () => {
  const input = { recordMesgs: [
    { timestamp: at(0), power: 0, heartRate: 135, cadence: 83, speed: 4.5,
      positionLat: 123456789, positionLong: -123456789, serialNumber: 'private' },
    { timestamp: at(3), power: 220, heartRate: 140, enhancedSpeed: 6.2 },
  ] };
  const result = normalizeFitRecordMessages(input);
  assert.equal(result.samples[0].power_watts, 0);
  assert.equal(result.samples[1].power_watts, 220);
  assert.equal(result.samples[1].speed_m_s, 6.2);
  assert.equal(result.samples[1].cadence_raw, null);
  assert.equal(result.quality.populated_channels.power_watts, 2);
  assert.equal(result.quality.coverage_basis, 'record_count');
  assert.equal(result.quality.sensor_provenance, 'unverified');
  assert.doesNotMatch(JSON.stringify(result), /positionLat|positionLong|serialNumber|private/);
});

test('distingue cero vatios de ausencia de potencia', () => {
  const result = normalizeFitRecordMessages({recordMesgs: [
    {timestamp: at(0), power: 0}, {timestamp: at(1)}, {timestamp: at(2), power: null},
  ]});
  assert.deepEqual(result.samples.map(x => x.power_watts), [0, null, null]);
  assert.equal(result.quality.populated_channels.power_watts, 1);
});

test('marca mediciones inválidas sin inventar sustituciones', () => {
  const result = normalizeFitRecordMessages({recordMesgs: [
    {timestamp: at(0), power: -3, heartRate: '165', cadence: Infinity, enhancedSpeed: 200, speed: 3},
  ]});
  assert.deepEqual(result.samples.map(x => [x.power_watts, x.heart_rate_bpm, x.cadence_raw, x.speed_m_s]),
    [[null, null, null, null]]);
  assert.deepEqual(Object.values(result.quality.invalid_channels), [1, 1, 1, 1]);
});

test('ordena registros sin eliminar duplicados silenciosamente', () => {
  const result = normalizeFitRecordMessages({recordMesgs: [
    {timestamp: at(2), power: 110}, {timestamp: at(0), power: 100}, {timestamp: at(2), power: 120},
  ]});
  assert.equal(result.samples.length, 3);
  assert.equal(result.samples[0].power_watts, 100);
  assert.equal(result.quality.duplicate_timestamps, 1);
});

test('descarta timestamps ambiguos y cuenta las pérdidas', () => {
  const result = normalizeFitRecordMessages({recordMesgs: [
    {timestamp: 123456789, power: 250}, {timestamp: 'not a date', heartRate: 145}, {timestamp: at(0), power: 200},
  ]});
  assert.equal(result.samples.length, 1);
  assert.equal(result.quality.invalid_timestamps, 2);
});

test('rechaza registros mal formados o carga excesiva', () => {
  assert.throws(() => normalizeFitRecordMessages({}), /recordMesgs/);
  assert.throws(() => normalizeFitRecordMessages({recordMesgs: new Array(200001)}), /too_many_fit_records/);
});
