// Preliminary FIT Record normalizer. It accepts messages decoded by Garmin's
// official FIT SDK; it does NOT download FIT files or process binary FIT itself.
// Keep this module side-effect-free until a separate, consented, tested ingestion
// flow is implemented. No GPS coordinates or identifiers leave this function.
const LIMIT = 200000;
const FIELDS = {
  power_watts: { keys: ['power'], min: 0, max: 3500 },
  heart_rate_bpm: { keys: ['heartRate'], min: 25, max: 250 },
  cadence_raw: { keys: ['cadence'], min: 0, max: 300 },
  speed_m_s: { keys: ['enhancedSpeed', 'speed'], min: 0, max: 50 },
};

function normalizedTimestamp(value) {
  // The official JavaScript FIT SDK defaults to convertDateTimesToDates=true.
  // Refuse ambiguous numeric epochs rather than shifting activity timestamps.
  if (!(value instanceof Date) && typeof value !== 'string') return null;
  const time = value instanceof Date ? value.getTime() : Date.parse(value);
  return Number.isFinite(time) && time >= 631065600000 && time <= 4102444800000
    ? new Date(time).toISOString() : null;
}

function readChannel(row, spec, invalidCount, name) {
  const key = spec.keys.find(k => Object.hasOwn(row, k) && row[k] !== null && row[k] !== undefined);
  if (!key) return null;
  const value = row[key];
  if (typeof value !== 'number' || !Number.isFinite(value) || value < spec.min || value > spec.max) {
    invalidCount[name]++;
    return null;
  }
  return value;
}

export function normalizeFitRecordMessages(messages) {
  if (!messages || !Array.isArray(messages.recordMesgs)) {
    throw new TypeError('FIT SDK recordMesgs array required');
  }
  if (messages.recordMesgs.length > LIMIT) {
    throw new RangeError('too_many_fit_records');
  }
  const invalidChannels = Object.fromEntries(Object.keys(FIELDS).map(key => [key, 0]));
  const populatedChannels = Object.fromEntries(Object.keys(FIELDS).map(key => [key, 0]));
  const samples = [];
  let invalidTimestamps = 0;
  for (const record of messages.recordMesgs) {
    if (!record || typeof record !== 'object' || Array.isArray(record)) {
      invalidTimestamps++;
      continue;
    }
    const timestamp = normalizedTimestamp(record.timestamp);
    if (!timestamp) {
      invalidTimestamps++;
      continue;
    }
    const sample = { timestamp };
    for (const [key, spec] of Object.entries(FIELDS)) {
      sample[key] = readChannel(record, spec, invalidChannels, key);
      if (sample[key] !== null) populatedChannels[key]++;
    }
    // Intentionally discard positionLat / positionLong and unrecognized fields.
    samples.push(sample);
  }
  // FIT messages may arrive in summary-first or summary-last order.
  samples.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  let duplicateTimestamps = 0;
  for (let i = 1; i < samples.length; i++) {
    if (samples[i].timestamp === samples[i - 1].timestamp) duplicateTimestamps++;
  }
  return {
    samples,
    quality: {
      input_records: messages.recordMesgs.length,
      valid_timestamp_records: samples.length,
      invalid_timestamps: invalidTimestamps,
      duplicate_timestamps: duplicateTimestamps,
      populated_channels: populatedChannels,
      invalid_channels: invalidChannels,
      // Number of FIT records with a channel; NOT a duration-weighted coverage.
      coverage_basis: 'record_count',
      sensor_provenance: 'unverified',
      moving_time: 'not_computed',
    },
  };
}
