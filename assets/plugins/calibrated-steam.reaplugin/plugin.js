/* Calibrated Steam Timer. GPL-3.0-only. Inspired by Damian / Damian-AU, DSx2. */
(function () {
"use strict";
const MANIFEST = {"id":"calibrated-steam.reaplugin","name":"Auto Steam Calculator","author":"pponce; calculation and pitcher heuristic inspired by Damian / Damian-AU (DSx2)","description":"Estimate steam duration from milk weight using your calibration. Inspired by Damian's DSx2 calculator. This estimates temperature through time; it does not measure milk temperature.","version":"0.4.0","apiVersion":1,"permissions":["api"],"settings":{"smallJugGrams":{"type":"number","label":"Small empty pitcher (g)","description":"Untared weight of the empty small pitcher. Leave blank or 0 if not configured.","default":0},"mediumJugGrams":{"type":"number","label":"Medium empty pitcher (g)","description":"Untared weight of the empty medium pitcher. Leave blank or 0 if not configured.","default":0},"largeJugGrams":{"type":"number","label":"Large empty pitcher (g)","description":"Untared weight of the empty large pitcher. Leave blank or 0 if not configured.","default":0},"singleDrinkGrams":{"type":"number","label":"Usual milk per drink (g)","description":"Milk only for one drink; used to infer pitcher size in Auto. This can differ from your calibration milk weight.","default":0},"singleDrinkJug":{"type":"enum","label":"Pitcher normally used for one drink","description":"Select small or medium to choose the pitcher-detection thresholds.","values":["","small","medium"],"default":""},"weightMode":{"type":"enum","label":"Scale weight mode","description":"Gross includes the empty pitcher. Tared is milk only: pitcher size cannot be inferred and no pitcher weight is subtracted.","values":["gross","tared"],"default":"gross"},"referenceMilkGrams":{"type":"number","label":"Calibration milk weight (g)","description":"Milk only, excluding the pitcher, from your measured calibration run.","default":0},"referenceSeconds":{"type":"number","label":"Time to your desired milk temperature (s)","description":"Actual steaming time in the calibration run. Use similar milk, starting temperature and steaming technique for subsequent drinks.","default":0},"referenceFlow":{"type":"number","label":"Auto steam flow (ml/s)","description":"Flow used for calibration and applied in Auto steam mode. Configurable from 0.4 to 2.5 ml/s; default 0.4 ml/s. Recalibrate the time if you change this flow.","default":0.4},"defaultJug":{"type":"enum","label":"Starting pitcher selection","description":"Small, Medium or Large subtracts that pitcher weight. Auto guesses the pitcher using milk per drink. Streamline remembers subsequent preset selections.","values":["small","medium","large","auto"],"default":"small"},"autoDetect":{"type":"boolean","label":"Offer Auto pitcher selection","description":"Enable automatic detection using Damian’s heuristic. Requires all three pitcher weights, gross scale weight, usual milk per drink and the pitcher normally used for one drink.","default":false}},"api":[{"id":"status","type":"http","data":{}},{"id":"calculate","type":"http","data":{}},{"id":"validate","type":"http","data":{}},{"id":"ui","type":"http","data":{}}]};
class CalculationError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

function configuredPitchers(settings) {
  return ['small', 'medium', 'large'].filter(size => {
    const weight = settings[`${size}JugGrams`];
    return Number.isFinite(weight) && weight >= 1 && weight <= 3000;
  });
}

function availablePitchers(settings) {
  const choices = configuredPitchers(settings);
  if (settings.autoDetect === true && settings.weightMode === 'gross' && choices.length === 3 &&
      Number.isFinite(settings.singleDrinkGrams) && settings.singleDrinkGrams >= 10 && settings.singleDrinkGrams <= 1000 &&
      ['small', 'medium'].includes(settings.singleDrinkJug)) choices.push('auto');
  return choices;
}

function validateSettings(settings) {
  const errors = [];
  const names = {
    referenceMilkGrams: 'Calibration milk weight', referenceSeconds: 'Calibration time',
    referenceFlow: 'Calibration flow', singleDrinkGrams: 'Usual milk per drink',
    smallJugGrams: 'Small pitcher weight', mediumJugGrams: 'Medium pitcher weight', largeJugGrams: 'Large pitcher weight',
  };
  const range = (key, minimum, maximum, integer = false) => {
    const value = settings[key];
    if (!Number.isFinite(value) || value < minimum || value > maximum || (integer && !Number.isInteger(value))) {
      errors.push({ field: key, message: `${names[key]} must be ${integer ? 'a whole number ' : ''}between ${minimum} and ${maximum}.` });
    }
  };
  range('referenceMilkGrams', 10, 1500);
  range('referenceSeconds', 1, 255);
  range('referenceFlow', 0.4, 2.5);
  for (const key of ['smallJugGrams', 'mediumJugGrams', 'largeJugGrams']) range(key, settings[key] === 0 ? 0 : 1, 3000);
  if (!configuredPitchers(settings).length) errors.push({ field: 'pitchers', message: 'Enter at least one empty pitcher weight (1–3000 g).' });
  if (!['gross', 'tared'].includes(settings.weightMode)) errors.push({ field: 'weightMode', message: 'Choose gross or tared scale weight.' });
  if (typeof settings.autoDetect !== 'boolean') errors.push({ field: 'autoDetect', message: 'Choose whether to offer automatic pitcher detection.' });
  if (settings.autoDetect === true) {
    range('singleDrinkGrams', 10, 1000);
    if (!['small', 'medium'].includes(settings.singleDrinkJug)) errors.push({ field: 'singleDrinkJug', message: 'Choose the small or medium pitcher normally used for one drink.' });
    if (configuredPitchers(settings).length !== 3) errors.push({ field: 'pitchers', message: 'Automatic detection requires all three pitcher weights for Damian’s detection thresholds.' });
    if (settings.weightMode !== 'gross') errors.push({ field: 'weightMode', message: 'Automatic pitcher detection requires gross weight (pitcher plus milk).' });
  }
  if (settings.defaultJug !== undefined && configuredPitchers(settings).length && !availablePitchers(settings).includes(settings.defaultJug)) {
    errors.push({ field: 'defaultJug', message: 'Choose a configured starting pitcher selection.' });
  }
  return errors;
}

function fail(code, message) {
  throw new CalculationError(code, message);
}

function stableWeight(samples) {
  const message = 'Place the filled pitcher on the scale and wait for a fresh, stable reading.';
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
  if (!['auto', 'small', 'medium', 'large'].includes(choice)) fail('invalid_request', 'Choose Auto, Small, Medium or Large pitcher.');
  if (!availablePitchers(settings).includes(choice)) fail('pitcher_not_configured', 'Configure this pitcher selection in Settings before calculating.');
  if (input.machineState !== 'idle') fail('machine_not_idle', 'Wait until the machine is idle before setting a steam time.');
  if (!Number.isFinite(input.stopAtTemperature) || input.stopAtTemperature !== 0) fail('probe_stop_active', 'Turn off milk-probe stopping before using the calibrated timer.');
  const scaleGrams = stableWeight(input.samples);
  const tared = settings.weightMode === 'tared';
  const jug = choice !== 'auto' ? choice : (tared ? null : inferredJug(settings, scaleGrams));
  const jugGrams = tared ? 0 : settings[`${jug}JugGrams`];
  const milkGrams = Math.round((scaleGrams - jugGrams) * 10) / 10;
  if (milkGrams < 10 || milkGrams > 1500) fail('invalid_milk_weight', 'Calculated milk weight must be 10–1500 g. Check the pitcher choice and whether the scale was tared.');
  const durationSeconds = Math.round(settings.referenceSeconds * milkGrams / settings.referenceMilkGrams);
  if (durationSeconds < 1 || durationSeconds > 255) fail('duration_out_of_range', `Calculated time ${durationSeconds}s is outside the supported timer range of 1–255 seconds. Check the calibration and milk amount.`);
  return {
    apiVersion: 3, jug, jugSource: tared ? 'tared' : (choice === 'auto' ? 'heuristic' : 'manual'),
    scaleGrams, jugGrams, milkGrams, durationSeconds,
    workflowPatch: { steamSettings: { duration: durationSeconds, flow: settings.referenceFlow } },
  };
}

function settingsReturnUrl(currentUrl, referrer = '') {
  const current = new URL(currentUrl);
  const fallback = new URL('/api/v1/plugins/settings.reaplugin/ui', current).href;
  const loopback = hostname => ['localhost', '127.0.0.1', '[::1]'].includes(hostname);
  for (const candidate of [current.searchParams.get('returnTo'), referrer]) {
    if (!candidate) continue;
    try {
      const target = new URL(candidate, current);
      const sameHost = target.hostname === current.hostname || (loopback(target.hostname) && loopback(current.hostname));
      if (sameHost && ['http:', 'https:'].includes(target.protocol) && !target.username && !target.password &&
          !(target.origin === current.origin && target.pathname === current.pathname)) return target.href;
    } catch {}
  }
  return fallback;
}

function settingsBrowser(resolveReturnUrl) {
  const base = '/api/v1/plugins/calibrated-steam.reaplugin';
  const form = document.getElementById('settings');
  const status = document.getElementById('status');
  const save = document.getElementById('save');
  const back = document.getElementById('return-settings');
  back.href = resolveReturnUrl(window.location.href, document.referrer);
  let schema = {};
  async function request(path, options) {
    const response = await fetch(path, options);
    const data = await response.json();
    if (!response.ok) throw new Error(data.message || data.error || (data.errors || []).map(error => error.message).join(' ') || 'Request failed.');
    return data;
  }
  async function load() {
    try {
      const data = await request(base + '/status');
      schema = data.schema;
      const groups = [
        ['Pitcher weights and selection', ['smallJugGrams', 'mediumJugGrams', 'largeJugGrams', 'weightMode', 'autoDetect', 'defaultJug']],
        ['Automatic pitcher detection', ['singleDrinkGrams', 'singleDrinkJug']],
        ['Steam calibration', ['referenceMilkGrams', 'referenceSeconds', 'referenceFlow']],
      ];
      const labels = {};
      for (const [heading, keys] of groups) {
        const section = document.createElement('fieldset');
        const legend = document.createElement('legend');
        legend.textContent = heading;
        section.append(legend);
        form.append(section);
        for (const key of keys) {
          const item = schema[key];
          if (!item) continue;
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
              option.textContent = value || 'Choose a pitcher';
              input.append(option);
            }
          } else if (item.type === 'boolean') {
            input.type = 'checkbox';
            input.checked = data.settings[key] === true;
          } else {
            input.type = 'number';
            input.step = 'any';
            input.inputMode = 'decimal';
            input.required = !key.endsWith('JugGrams');
            input.min = key === 'referenceFlow' ? '0.4' : '0';
            if (key === 'referenceFlow') { input.max = '2.5'; input.step = '0.1'; }
          }
          if (item.type !== 'boolean') input.value = item.type === 'number' && data.settings[key] === 0 ? '' : data.settings[key];
          label.append(input);
          const help = document.createElement('small');
          help.textContent = item.description;
          label.append(help);
          section.append(label);
          labels[key] = label;
        }
      }
      const field = key => form.elements.namedItem(key);
      const updateChoices = () => {
        const automatic = field('autoDetect').checked;
        for (const key of ['singleDrinkGrams', 'singleDrinkJug']) {
          labels[key].closest('fieldset').hidden = !automatic;
          field(key).required = automatic;
        }
        const choices = ['small', 'medium', 'large'].filter(size => {
          const weight = Number(field(`${size}JugGrams`).value);
          return weight >= 1 && weight <= 3000;
        });
        const milk = Number(field('singleDrinkGrams').value);
        if (automatic && choices.length === 3 && field('weightMode').value === 'gross' && milk >= 10 && milk <= 1000 &&
            ['small', 'medium'].includes(field('singleDrinkJug').value)) choices.push('auto');
        const select = field('defaultJug');
        const previous = select.value;
        select.replaceChildren();
        for (const value of choices) {
          const option = document.createElement('option');
          option.value = value;
          option.textContent = value === 'auto' ? 'Auto' : value[0].toUpperCase() + value.slice(1);
          select.append(option);
        }
        select.value = choices.includes(previous) ? previous : (choices[0] ?? '');
        select.disabled = choices.length === 0;
      };
      form.addEventListener('input', updateChoices);
      form.addEventListener('change', updateChoices);
      updateChoices();
      status.textContent = data.ready ? 'Calibration is ready.' : 'Enter at least one pitcher weight and your measured calibration. Steam stays Off in Auto mode until setup and a calculation are complete.';
      save.disabled = false;
    } catch (error) { status.textContent = error.message; }
  }
  form.addEventListener('submit', async event => {
    event.preventDefault();
    save.disabled = true;
    try {
      const values = Object.fromEntries(Object.entries(schema).map(([key, item]) => {
        const input = form.elements.namedItem(key);
        return [key, item.type === 'boolean' ? input.checked : item.type === 'number' ? (input.value.trim() === '' ? 0 : Number(input.value)) : input.value];
      }));
      const options = { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(values) };
      await request(base + '/validate', options);
      await request(base + '/settings', options);
      window.location.assign(back.href);
    } catch (error) { status.textContent = error.message; }
    finally { save.disabled = false; }
  });
  load();
}

function settingsPage() {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Auto Steam Calculator</title>
<style>:root{color-scheme:light dark;font:18px system-ui,sans-serif}body{max-width:850px;margin:auto;padding:24px;background:Canvas;color:CanvasText}h1{font-size:28px}p{line-height:1.5}fieldset{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:22px;border:1px solid GrayText;border-radius:8px;padding:20px}legend{font-weight:600}fieldset[hidden]{display:none}form{display:grid;grid-template-columns:1fr;gap:22px}label{display:flex;flex-direction:column;gap:8px}label span{font-weight:600}small{opacity:.8;line-height:1.4}input,select,button{font:inherit;padding:12px;border:1px solid GrayText;border-radius:8px;color:CanvasText;background:Canvas}input[type=checkbox]{width:28px;height:28px}button{cursor:pointer;min-height:48px}#status{min-height:2em}a{color:LinkText}#return-settings{display:inline-block;padding:14px 18px;border:1px solid GrayText;border-radius:8px;text-decoration:none}footer{margin-top:28px;font-size:15px}</style></head><body>
<a id="return-settings" href="/api/v1/plugins/settings.reaplugin/ui">Return to settings</a>
<h1>Auto Steam Calculator</h1><p>Measure how long a known weight of milk takes to reach your preferred temperature. Use similar starting milk temperature, milk type and steaming technique each time. The timer estimates the result; it does not read milk temperature.</p>
<p>Enter at least one empty pitcher weight. Leave unused sizes blank or 0; only configured sizes appear in the steam controls. Choose a starting pitcher selection; the skin can remember subsequent selections.</p>
<p>Enable <strong>Offer Auto pitcher selection</strong> if you want automatic detection. Then enter your usual milk per drink and the pitcher normally used for one drink. Damian’s detection thresholds require all three pitcher weights and <strong>gross</strong> scale weight (pitcher plus milk, without taring). With Auto detection disabled, you can configure just the sizes you use. <strong>Tared</strong> mode uses milk weight only and does not subtract the pitcher.</p>
<p>For calibration, use manual Flow or Time mode to steam a known milk-only weight to your preferred temperature. Record the seconds and flow used. Auto steam mode applies that flow with each calculated time. Use the same normal steam heater setting; the calculator does not compensate for changes to heater or starting milk temperature.</p><form id="settings"></form><p id="status" role="status" aria-live="polite">Loading settings…</p><button id="save" form="settings" type="submit" disabled>Save calibration</button>
<footer>Calibration formula and automatic pitcher-selection heuristic inspired by <a href="https://github.com/Damian-AU/DSx2">Damian / Damian-AU’s DSx2</a>. JavaScript implementation for Decaid by pponce.</footer>
<script>(${settingsBrowser.toString()})(${settingsReturnUrl.toString()});</script></body></html>`;
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
    onLoad(values = {}) {
      settings = configured(values);
      if (settings.referenceFlow === 0) settings.referenceFlow = defaults.referenceFlow;
      if (values.autoDetect === undefined && !availablePitchers(settings).includes(settings.defaultJug)) {
        settings.defaultJug = configuredPitchers(settings)[0] ?? 'small';
      }
      loaded = true;
    },
    onUnload() { loaded = false; settings = {}; },
    __httpRequestHandler(request) {
      if (!loaded) return json(503, { code: 'plugin_disabled', message: 'Enable the calibrated steam plugin.' });
      const { endpoint, method, body } = request;
      const methods = { status: 'GET', calculate: 'POST', validate: 'POST', ui: 'GET' };
      if (!methods[endpoint]) return json(404, { code: 'not_found', message: 'Unknown endpoint.' });
      if (method !== methods[endpoint]) return json(405, { code: 'method_not_allowed', message: `Use ${methods[endpoint]}.` });
      if (endpoint === 'status') return json(200, { apiVersion: 3, version: MANIFEST.version, ready: validateSettings(settings).length === 0, settings, availablePitchers: availablePitchers(settings), errors: validateSettings(settings), schema: MANIFEST.settings });
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
