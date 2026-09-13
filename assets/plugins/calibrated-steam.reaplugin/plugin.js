/* Calibrated Steam Timer. GPL-3.0-only. Inspired by Damian / Damian-AU, DSx2. */
(function () {
"use strict";
const MANIFEST = {"id":"calibrated-steam.reaplugin","name":"Calibrated Steam Timer","author":"pponce; calculation and jug heuristic inspired by Damian / Damian-AU (DSx2)","description":"Estimate steam duration from milk weight using your calibration. Inspired by Damian's DSx2 calculator. This estimates temperature through time; it does not measure milk temperature.","version":"0.1.0","apiVersion":1,"permissions":["api"],"settings":{"smallJugGrams":{"type":"number","label":"Small empty jug (g)","description":"Untared weight of the empty small jug.","default":0},"mediumJugGrams":{"type":"number","label":"Medium empty jug (g)","description":"Untared weight of the empty medium jug.","default":0},"largeJugGrams":{"type":"number","label":"Large empty jug (g)","description":"Untared weight of the empty large jug.","default":0},"singleDrinkGrams":{"type":"number","label":"Milk for one drink (g)","description":"Your usual milk amount for one drink; used in Damian's automatic jug-selection heuristic.","default":160},"singleDrinkJug":{"type":"enum","label":"Jug normally used for one drink","description":"Select small or medium to choose the jug-detection thresholds.","values":["small","medium"],"default":"small"},"weightMode":{"type":"enum","label":"Scale weight mode","description":"Gross includes the empty jug. Tared is milk only: jug size cannot be inferred and no jug weight is subtracted.","values":["gross","tared"],"default":"gross"},"referenceMilkGrams":{"type":"number","label":"Calibration milk weight (g)","description":"Milk only, excluding the jug, from your measured calibration run.","default":0},"referenceSeconds":{"type":"number","label":"Time to your desired milk temperature (s)","description":"Actual steaming time in the calibration run. Use similar milk, starting temperature and steaming technique for subsequent drinks.","default":0},"referenceFlow":{"type":"number","label":"Calibration steam flow (ml/s)","description":"Machine steam flow setting used during calibration. The current flow must match.","default":0},"referenceSteamTemperature":{"type":"number","label":"Calibration steam heater temperature (°C)","description":"Machine heater setpoint used during calibration, 135–165 °C. This is not the milk temperature.","default":0},"maxSeconds":{"type":"number","label":"Maximum calculated duration (s)","description":"Reject longer results rather than silently shortening them. Whole seconds, 1–255.","default":120}},"api":[{"id":"status","type":"http","data":{}},{"id":"calculate","type":"http","data":{}},{"id":"validate","type":"http","data":{}},{"id":"ui","type":"http","data":{}}]};
class CalculationError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

function validateSettings(settings) {
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

function calculate(settings, input) {
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

function settingsBrowser() {
  const base = '/api/v1/plugins/calibrated-steam.reaplugin';
  const form = document.getElementById('settings');
  const status = document.getElementById('status');
  const save = document.getElementById('save');
  let schema = {};
  async function request(path, options) {
    const response = await fetch(path, options);
    const data = await response.json();
    if (!response.ok) throw new Error(data.message || (data.errors || []).map(error => error.message).join(' ') || 'Request failed.');
    return data;
  }
  async function load() {
    try {
      const data = await request(base + '/status');
      schema = data.schema;
      for (const [key, item] of Object.entries(schema)) {
        const label = document.createElement('label');
        const title = document.createElement('span');
        title.textContent = item.label;
        label.append(title);
        const input = document.createElement(item.type === 'enum' ? 'select' : 'input');
        input.name = key;
        if (item.type === 'enum') {
          for (const value of item.values) {
            const option = document.createElement('option');
            option.value = value;
            option.textContent = value;
            input.append(option);
          }
        } else {
          input.type = 'number';
          input.step = 'any';
          input.inputMode = 'decimal';
          input.required = true;
        }
        input.value = data.settings[key];
        label.append(input);
        const help = document.createElement('small');
        help.textContent = item.description;
        label.append(help);
        form.append(label);
      }
      status.textContent = data.ready ? 'Calibration is ready.' : 'Enter your measured calibration values before using Auto Calc.';
      save.disabled = false;
    } catch (error) { status.textContent = error.message; }
  }
  form.addEventListener('submit', async event => {
    event.preventDefault();
    save.disabled = true;
    try {
      const values = Object.fromEntries(Object.entries(schema).map(([key, item]) => {
        const value = form.elements.namedItem(key).value;
        return [key, item.type === 'number' ? (value.trim() === '' ? null : Number(value)) : value];
      }));
      const options = { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(values) };
      await request(base + '/validate', options);
      await request(base + '/settings', options);
      status.textContent = 'Saved. Return to the calculator to use this calibration.';
    } catch (error) { status.textContent = error.message; }
    finally { save.disabled = false; }
  });
  load();
}

function settingsPage() {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Calibrated Steam Timer</title>
<style>:root{color-scheme:light dark;font:18px system-ui,sans-serif}body{max-width:850px;margin:auto;padding:24px;background:Canvas;color:CanvasText}h1{font-size:28px}p{line-height:1.5}form{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:22px}label{display:flex;flex-direction:column;gap:8px}label span{font-weight:600}small{opacity:.8;line-height:1.4}input,select,button{font:inherit;padding:12px;border:1px solid GrayText;border-radius:8px;color:CanvasText;background:Canvas}button{cursor:pointer;min-height:48px}#status{min-height:2em}a{color:LinkText}footer{margin-top:28px;font-size:15px}</style></head><body>
<h1>Calibrated Steam Timer</h1><p>Measure how long a known weight of milk takes to reach your preferred temperature. Use similar starting milk temperature, milk type and steaming technique each time. The timer estimates the result; it does not read milk temperature.</p>
<p>For automatic jug selection, weigh the jug and milk together without taring. The jug choice is an estimate and can be corrected in the calculator. Choose <strong>tared</strong> mode if your scale displays milk weight only.</p>
<form id="settings"></form><p id="status" role="status" aria-live="polite">Loading settings…</p><button id="save" form="settings" type="submit" disabled>Save calibration</button>
<footer>Calibration formula and automatic jug-selection heuristic inspired by <a href="https://github.com/Damian-AU/DSx2">Damian / Damian-AU’s DSx2</a>. JavaScript implementation for Decaid by pponce.</footer>
<script>(${settingsBrowser.toString()})();</script></body></html>`;
}

globalThis.createPlugin = function createPlugin() {
  let settings = {};
  let loaded = false;
  const defaults = Object.fromEntries(Object.entries(MANIFEST.settings).map(([key, schema]) => [key, schema.default]));
  const json = (status, value) => ({ status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' }, body: JSON.stringify(value) });

  function configured(values) {
    return Object.fromEntries(Object.keys(defaults).map(key => [key, values[key] ?? defaults[key]]));
  }

  return {
    id: MANIFEST.id,
    version: MANIFEST.version,
    onLoad(values = {}) { settings = configured(values); loaded = true; },
    onUnload() { loaded = false; settings = {}; },
    __httpRequestHandler(request) {
      if (!loaded) return json(503, { code: 'plugin_disabled', message: 'Enable the calibrated steam plugin.' });
      const { endpoint, method, body } = request;
      const methods = { status: 'GET', calculate: 'POST', validate: 'POST', ui: 'GET' };
      if (!methods[endpoint]) return json(404, { code: 'not_found', message: 'Unknown endpoint.' });
      if (method !== methods[endpoint]) return json(405, { code: 'method_not_allowed', message: `Use ${methods[endpoint]}.` });
      if (endpoint === 'status') return json(200, { apiVersion: 1, version: MANIFEST.version, ready: validateSettings(settings).length === 0, settings, errors: validateSettings(settings), schema: MANIFEST.settings });
      if (endpoint === 'ui') return { status: 200, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }, body: settingsPage() };
      if (endpoint === 'validate') {
        if (!body || typeof body !== 'object' || Array.isArray(body)) return json(400, { code: 'invalid_request', message: 'Settings must be an object.' });
        const errors = validateSettings(configured(body));
        return json(errors.length ? 422 : 200, { valid: errors.length === 0, errors });
      }
      try {
        return json(200, { ...calculate(settings, body), calibrationRevision: JSON.stringify(settings) });
      } catch (error) {
        if (error instanceof CalculationError) return json(422, { code: error.code, message: error.message });
        return json(500, { code: 'calculation_failed', message: 'Unable to calculate a steam time.' });
      }
    },
  };
};

})();
