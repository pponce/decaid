export class CalculationError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

export function validateSettings(settings) {
  const errors = [];
  const range = (key, minimum, maximum, integer = false) => {
    const value = settings[key];
    if (!Number.isFinite(value) || value < minimum || value > maximum || (integer && !Number.isInteger(value))) {
      errors.push({ field: key, message: `${key} must be ${integer ? 'a whole number ' : ''}between ${minimum} and ${maximum}.` });
    }
  };
  range('referenceMilkGrams', 10, 1500);
  range('referenceSeconds', 1, 255);
  range('referenceFlow', 0.1, 2.5);
  range('referenceSteamTemperature', 135, 165, true);
  range('maxSeconds', 1, 255, true);
  range('singleDrinkGrams', 10, 1000);
  for (const key of ['smallJugGrams', 'mediumJugGrams', 'largeJugGrams']) {
    range(key, settings.weightMode === 'tared' ? 0 : 1, 3000);
  }
  if (!['gross', 'tared'].includes(settings.weightMode)) errors.push({ field: 'weightMode', message: 'Choose gross or tared scale weight.' });
  if (!['small', 'medium'].includes(settings.singleDrinkJug)) errors.push({ field: 'singleDrinkJug', message: 'Choose the small or medium jug for one drink.' });
  return errors;
}

function fail(code, message) {
  throw new CalculationError(code, message);
}

function stableWeight(samples) {
  const message = 'Place the filled jug on the scale and wait for a fresh, stable reading.';
  if (!Array.isArray(samples) || samples.length < 3 || samples.length > 64) fail('scale_not_ready', message);
  for (let index = 0; index < samples.length; index++) {
    const sample = samples[index];
    if (!sample || !Number.isFinite(sample.weightGrams) || !Number.isFinite(sample.ageMs) || sample.ageMs < 0 || sample.ageMs > 2500) fail('scale_not_ready', message);
    if (index > 0 && sample.ageMs >= samples[index - 1].ageMs) fail('scale_not_ready', message);
  }
  const latest = samples[samples.length - 1];
  if (latest.ageMs > 1500 || samples[0].ageMs - latest.ageMs < 500) fail('scale_not_ready', message);
  const weights = samples.map(sample => sample.weightGrams).sort((a, b) => a - b);
  if (weights[weights.length - 1] - weights[0] > 2) fail('scale_not_ready', message);
  const middle = Math.floor(weights.length / 2);
  return weights.length % 2 ? weights[middle] : (weights[middle - 1] + weights[middle]) / 2;
}

function inferredJug(settings, weight) {
  const singleIsSmall = settings.singleDrinkJug === 'small';
  const mediumThreshold = (singleIsSmall ? 1.7 : 0.7) * settings.singleDrinkGrams + settings.smallJugGrams;
  const largeThreshold = (singleIsSmall ? 2.7 : 1.7) * settings.singleDrinkGrams + settings.mediumJugGrams;
  let jug = 'small';
  if (weight > mediumThreshold) jug = 'medium';
  if (weight > largeThreshold) jug = 'large';
  return jug;
}

export function calculate(settings, input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail('invalid_request', 'A calculation request is required.');
  if (validateSettings(settings).length) fail('configuration_required', 'Complete the calibration settings before calculating.');
  const choice = input.jug ?? 'auto';
  if (!['auto', 'small', 'medium', 'large'].includes(choice)) fail('invalid_request', 'Choose Auto, Small, Medium or Large jug.');
  if (input.machineState !== 'idle') fail('machine_not_idle', 'Wait until the machine is idle before setting a steam time.');
  if (!Number.isFinite(input.stopAtTemperature) || input.stopAtTemperature !== 0) fail('probe_stop_active', 'Turn off milk-probe stopping before using the calibrated timer.');
  if (!Number.isFinite(input.steamFlow) || !Number.isFinite(input.steamTemperature) ||
      Math.abs(input.steamFlow - settings.referenceFlow) > 0.001 || input.steamTemperature !== settings.referenceSteamTemperature) {
    fail('calibration_mismatch', `Calibration requires steam flow ${settings.referenceFlow} ml/s and heater temperature ${settings.referenceSteamTemperature} °C. Restore these settings or recalibrate.`);
  }
  const scaleGrams = stableWeight(input.samples);
  const tared = settings.weightMode === 'tared';
  const jug = choice !== 'auto' ? choice : (tared ? null : inferredJug(settings, scaleGrams));
  const jugGrams = tared ? 0 : settings[`${jug}JugGrams`];
  const milkGrams = Math.round((scaleGrams - jugGrams) * 10) / 10;
  if (milkGrams < 10 || milkGrams > 1500) fail('invalid_milk_weight', 'Calculated milk weight must be 10–1500 g. Check the jug choice and whether the scale was tared.');
  const durationSeconds = Math.round(settings.referenceSeconds * milkGrams / settings.referenceMilkGrams);
  if (durationSeconds < 1 || durationSeconds > settings.maxSeconds || durationSeconds > 255) fail('duration_out_of_range', `Calculated time ${durationSeconds}s is outside 1–${settings.maxSeconds}s. Check the calibration and milk amount.`);
  return {
    apiVersion: 1, jug, jugSource: tared ? 'tared' : (choice === 'auto' ? 'heuristic' : 'manual'),
    scaleGrams, jugGrams, milkGrams, durationSeconds,
    workflowPatch: { steamSettings: { duration: durationSeconds } },
  };
}
