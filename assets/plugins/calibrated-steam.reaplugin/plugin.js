/* Calibrated Steam Timer. GPL-3.0-only. Inspired by Damian / Damian-AU, DSx2. */
(function () {
"use strict";
const MANIFEST = {"id":"calibrated-steam.reaplugin","name":"Auto Steam Calculator","author":"pponce; calculation and pitcher heuristic inspired by Damian / Damian-AU (DSx2)","description":"Estimate steam duration from milk weight using your calibration. Inspired by Damian's DSx2 calculator. This estimates temperature through time; it does not measure milk temperature.","version":"0.5.0","apiVersion":1,"permissions":["api","events.machine"],"settings":{"smallJugGrams":{"type":"number","label":"Small empty pitcher (g)","description":"Untared weight of the empty small pitcher. Leave blank or 0 if not configured.","default":0},"mediumJugGrams":{"type":"number","label":"Medium empty pitcher (g)","description":"Untared weight of the empty medium pitcher. Leave blank or 0 if not configured.","default":0},"largeJugGrams":{"type":"number","label":"Large empty pitcher (g)","description":"Untared weight of the empty large pitcher. Leave blank or 0 if not configured.","default":0},"singleDrinkGrams":{"type":"number","label":"Usual milk per drink (g)","description":"Milk only for one drink; used to infer pitcher size in Auto. This can differ from your calibration milk weight.","default":0},"singleDrinkJug":{"type":"enum","label":"Pitcher normally used for one drink","description":"Select small or medium to choose the pitcher-detection thresholds.","values":["","small","medium"],"default":""},"weightMode":{"type":"enum","label":"Scale weight mode","description":"Gross includes the empty pitcher. Tared is milk only: pitcher size cannot be inferred and no pitcher weight is subtracted.","values":["gross","tared"],"default":"gross"},"referenceMilkGrams":{"type":"number","label":"Calibration milk weight (g)","description":"Milk only, excluding the pitcher, from your measured calibration run.","default":0},"referenceSeconds":{"type":"number","label":"Time to your desired milk temperature (s)","description":"Actual steaming time in the calibration run. Use similar milk, starting temperature and steaming technique for subsequent drinks.","default":0},"referenceFlow":{"type":"number","label":"Auto steam flow (ml/s)","description":"Flow used for calibration and applied in Auto steam mode. Configurable from 0.4 to 2.5 ml/s; default 0.4 ml/s. Recalibrate the time if you change this flow.","default":0.4},"defaultJug":{"type":"enum","label":"Starting pitcher selection","description":"Small, Medium or Large subtracts that pitcher weight. Auto guesses the pitcher using milk per drink. Streamline remembers subsequent preset selections.","values":["small","medium","large","auto"],"default":"small"},"autoDetect":{"type":"boolean","label":"Offer Auto pitcher selection","description":"Enable automatic detection using Damian’s heuristic. Requires all three pitcher weights, gross scale weight, usual milk per drink and the pitcher normally used for one drink.","default":false}},"api":[{"id":"status","type":"http","data":{}},{"id":"calculate","type":"http","data":{}},{"id":"validate","type":"http","data":{}},{"id":"ui","type":"http","data":{}},{"id":"calibration","type":"http","data":{}}]};
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

function captureScaleWeight(samples, now) {
  const recent = samples.filter(sample => Number.isFinite(sample.weight) && now - sample.at >= 0 && now - sample.at <= 2500);
  if (!recent.length || now - recent.at(-1).at > 1500) throw new Error('Wait for a fresh scale reading.');
  if (recent.length < 3 || recent.at(-1).at - recent[0].at < 500 ||
      Math.max(...recent.map(s => s.weight)) - Math.min(...recent.map(s => s.weight)) > 2) {
    throw new Error('Wait for the scale weight to become stable.');
  }
  const values = recent.map(sample => sample.weight).sort((a, b) => a - b);
  const middle = Math.floor(values.length / 2);
  return Math.round((values.length % 2 ? values[middle] : (values[middle - 1] + values[middle]) / 2) * 10) / 10;
}

function createCalibrationSession({ now = () => Date.now(), readWorkflow, writeSteam, requestState }) {
  let phase = 'idle', message = '', result = null, measurement = null, original = null;
  let active = false, busy = false, lastSeen = 0, lastStamp = null, state = null;
  let lease = 0, seconds = 0, previousPouring = false, seenSteam = false;
  let invalid = false, finishing = false, startRequested = false, stopRequested = false;
  let stopSentAt = -Infinity, frameSerial = 0, restoreAfterFrame = -1;
  const snapshot = () => ({ active, phase, message, seconds: Math.round(seconds * 10) / 10, result, measurement });
  const fresh = () => state && now() - lastSeen <= 3000;
  function fail(reason) {
    invalid = true;
    finishing = true;
    result = null;
    message = reason;
  }
  async function sendStop(force = false) {
    if (fresh() && !['idle', 'steam'].includes(state) && !startRequested) return;
    if (!force && now() - stopSentAt < 1000) return;
    stopSentAt = now();
    restoreAfterFrame = frameSerial;
    try { await requestState('idle'); }
    catch { message = 'Unable to confirm stop. Use the machine’s stop control; restoration will retry.'; }
  }
  async function tick() {
    if (!active || busy) return;
    if (!finishing && now() - lease > 6000) fail('Calibration cancelled because the settings page stopped responding.');
    if (!finishing && !fresh()) fail('Machine telemetry was interrupted. Repeat calibration.');
    if (finishing || stopRequested) {
      if (!fresh() || state === 'steam' || startRequested) await sendStop();
      if (!finishing || !fresh() || state !== 'idle' || startRequested || frameSerial <= restoreAfterFrame) return;
      if (busy || !active) return;
      busy = true;
      phase = 'restoring';
      try {
        await writeSteam(original);
        active = false;
        phase = invalid ? 'failed' : 'complete';
        if (!invalid) {
          result = { ...measurement, seconds: Math.round(seconds * 10) / 10 };
          message = 'Calibration complete. Review the measured values, then save.';
        }
      } catch {
        message = 'Restoring previous steam settings failed. Retrying; keep the machine connected.';
      } finally { busy = false; }
    }
  }
  return {
    snapshot,
    heartbeat() { lease = now(); return snapshot(); },
    observe(frame) {
      const stamp = Date.parse(frame?.timestamp);
      const next = frame?.state?.state;
      if (!Number.isFinite(stamp) || typeof next !== 'string') return;
      if (lastStamp !== null && stamp <= lastStamp) return;
      frameSerial++;
      if (active && !finishing && lastStamp !== null && (now() - lastSeen > 3000 || stamp - lastStamp > 3000)) {
        fail('Machine telemetry was interrupted. Repeat calibration.');
      }
      if (active && !finishing) {
        if (previousPouring && lastStamp !== null) seconds += (stamp - lastStamp) / 1000;
        if (next === 'steam') {
          seenSteam = true;
          if (frame.state.substate === 'pouring') phase = 'steaming';
          else if (frame.state.substate === 'preparingForShot') phase = 'heating';
          else if (seconds > 0 && frame.state.substate === 'pausedSteam') {
            fail('Steam was paused or interrupted. Repeat with one continuous run.');
          }
        } else if (seenSteam) {
          finishing = true;
          if (next !== 'idle' || seconds < 1 || seconds >= 254) fail('Calibration was interrupted or reached the machine timer limit. Repeat calibration.');
        } else if (next !== 'idle' && !busy) fail('Machine left idle before calibration started.');
      }
      previousPouring = next === 'steam' && frame.state.substate === 'pouring';
      state = next;
      lastSeen = now();
      lastStamp = stamp;
    },
    async begin(options) {
      if (active) throw new Error('A calibration is already active.');
      if (!fresh() || state !== 'idle') throw new Error('Wait for a connected, idle machine.');
      const { milkGrams, pitcher, pitcherGrams, flow, heaterTemperature } = options;
      if (!['small', 'medium', 'large'].includes(pitcher) || !Number.isFinite(pitcherGrams) || pitcherGrams < 1 || pitcherGrams > 3000 ||
          !Number.isFinite(milkGrams) || milkGrams < 10 || milkGrams > 1500) throw new Error('Capture a configured pitcher containing 10–1500 g of milk.');
      if (!Number.isFinite(flow) || flow < 0.4 || flow > 2.5) throw new Error('Set a calibration flow from 0.4 to 2.5 ml/s.');
      active = true; busy = true; phase = 'preparing'; message = ''; result = null; original = null;
      seconds = 0; previousPouring = false; seenSteam = false; invalid = false; finishing = false;
      startRequested = false; stopRequested = false; stopSentAt = -Infinity; restoreAfterFrame = -1; lease = now();
      measurement = { milkGrams, pitcher, pitcherGrams, flow };
      try {
        const workflow = await readWorkflow();
        const steam = workflow?.steamSettings;
        const targetTemperature = steam?.targetTemperature > 0 ? steam.targetTemperature : heaterTemperature;
        if (!Number.isInteger(targetTemperature) || targetTemperature < 135 || targetTemperature > 165) throw new Error('Enable the normal steam heater in your skin settings, then return to calibrate.');
        if (!steam || !Number.isFinite(steam.duration) || !Number.isFinite(steam.flow)) throw new Error('Previous steam settings are unavailable.');
        if (!fresh() || state !== 'idle' || finishing) throw new Error('Calibration preparation was cancelled; wait for idle.');
        original = { ...steam };
        await writeSteam({ duration: 255, flow, targetTemperature, stopAtTemperature: 0 });
        if (!finishing && !seenSteam) {
          phase = 'armed';
          message = '';
        }
      } catch (error) {
        fail(error.message);
        if (!original) { active = false; phase = 'failed'; }
        throw error;
      } finally { busy = false; }
      await tick();
      return snapshot();
    },
    async start() {
      if (!active || busy || phase !== 'armed' || !fresh() || state !== 'idle' || startRequested || finishing) throw new Error('Prepare calibration with an idle machine before starting.');
      startRequested = true;
      busy = true;
      phase = 'starting';
      try { await requestState('steam'); }
      catch (error) { fail('Steam start could not be confirmed. Repeat calibration.'); throw error; }
      finally { busy = false; startRequested = false; }
      if (finishing || stopRequested) await sendStop(true);
      return snapshot();
    },
    async stop() {
      if (!active) return snapshot();
      stopRequested = true;
      if (phase === 'armed' && !seenSteam) fail('Calibration cancelled before steam started.');
      await sendStop();
      return snapshot();
    },
    async cancel(reason = 'Calibration cancelled. Previous steam settings restored.') {
      if (!active) return snapshot();
      fail(reason);
      await sendStop();
      await tick();
      return snapshot();
    },
    tick,
  };
}

function mountCalibrationPage({ form, labels, save, back, status, request, base, field, updateChoices }, captureWeight) {
  const sizes = ['small', 'medium', 'large'];
  let samples = [], zeroConfirmed = false, awaitingZero = false, tarePending = false;
  let captured = null, token = null, active = false, pending = false, timer = null, closed = false;
  let sessionPhase = 'idle';
  let returnAfterRestore = false, appliedResult = false, scaleSocket = null;
  const make = (tag, text) => { const element = document.createElement(tag); if (text) element.textContent = text; return element; };
  const button = (text, parent, action) => {
    const element = make('button', text); element.type = 'button'; parent.append(element);
    element.addEventListener('click', async () => {
      try { await action(); } catch (error) { status.textContent = error.message; }
    });
    return element;
  };
  const weights = labels.smallJugGrams.closest('fieldset');
  const scaleBox = make('div'); scaleBox.className = 'full-width';
  const scaleValue = make('p', 'Scale disconnected. Manual entry is available.');
  const tareHelp = make('p', 'Remove everything from the scale, tap Tare empty scale, and wait for zero before placing an empty pitcher on it.');
  scaleBox.append(tareHelp, scaleValue); weights.append(scaleBox);
  const guided = make('fieldset'); guided.className = 'guided-calibration';
  guided.append(make('legend', 'Guided calibration'));
  guided.append(make('p', '1. Tare the empty scale and wait for zero. Choose a configured pitcher, then place that pitcher with cold milk on the scale. Guided calibration always weighs pitcher plus milk, even when everyday calculation uses Tared mode.'));
  const pitcherLabel = make('label', 'Calibration pitcher');
  const pitcher = make('select'); pitcher.setAttribute('aria-label', 'Calibration pitcher'); pitcherLabel.append(pitcher); guided.append(pitcherLabel);
  const milk = make('p', 'Capture the pitcher plus milk to calculate the milk-only weight.');
  guided.append(milk);
  const actions = make('div'); actions.className = 'calibration-actions'; guided.append(actions);
  const runStatus = make('p', 'Use the flow entered under Steam calibration below. You can also enter milk weight and time manually.');
  runStatus.setAttribute('role', 'status'); runStatus.setAttribute('aria-live', 'polite');
  const elapsed = make('p', 'Steaming: 0.0 s'); elapsed.className = 'calibration-timer';
  guided.append(runStatus, elapsed);
  const guideHelp = make('p', '2. Prepare calibration to apply your selected flow. Place the wand in the milk, then start using this page or the machine. Stop when the milk reaches your preferred temperature. The counter excludes boiler warm-up. 3. Review the measured milk weight, time and flow, then Save calibration.');
  guided.append(guideHelp);
  form.insertBefore(guided, labels.referenceMilkGrams.closest('fieldset'));
  const captureButtons = [];
  function weight() {
    if (!zeroConfirmed || tarePending || awaitingZero) throw new Error('Tare the empty scale and wait for a stable zero first.');
    return captureWeight(samples, Date.now());
  }
  function clearCapture() {
    captured = null;
    milk.textContent = 'Capture the pitcher plus milk to calculate the milk-only weight.';
  }
  async function tare() {
    if (active || pending) throw new Error('Finish or cancel calibration before taring.');
    zeroConfirmed = false; awaitingZero = false; tarePending = true; samples = []; clearCapture(); paint();
    try {
      await request('/api/v1/scale/tare', { method: 'PUT' });
      samples = []; awaitingZero = true;
      scaleValue.textContent = 'Keep the scale empty. Waiting for a stable zero…';
    } finally { tarePending = false; paint(); }
  }
  const tarePitchers = button('Tare empty scale', scaleBox, tare);
  for (const size of sizes) {
    captureButtons.push(button('Set from scale', labels[size + 'JugGrams'], () => {
      const value = weight();
      if (value < 1 || value > 3000) throw new Error('Place an empty pitcher weighing 1–3000 g on the scale.');
      field(size + 'JugGrams').value = value;
      clearCapture(); updateChoices(); updatePitchers();
      status.textContent = size[0].toUpperCase() + size.slice(1) + ' pitcher set to ' + value + ' g. Save calibration to keep it.';
    }));
  }
  const tareMilk = button('Tare empty scale', actions, tare);
  const captureMilk = button('Capture pitcher + milk', actions, () => {
    const total = weight(), size = pitcher.value, pitcherGrams = Number(field(size + 'JugGrams')?.value);
    const milkGrams = Math.round((total - pitcherGrams) * 10) / 10;
    if (!sizes.includes(size) || !(pitcherGrams >= 1 && pitcherGrams <= 3000)) throw new Error('Configure and choose a pitcher first.');
    if (milkGrams < 10 || milkGrams > 1500) throw new Error('Milk-only weight must be 10–1500 g. Tare only with the scale empty.');
    captured = { pitcher: size, pitcherGrams, milkGrams };
    milk.textContent = total + ' g total − ' + pitcherGrams + ' g pitcher = ' + milkGrams + ' g milk. This starting milk weight is now captured.';
    paint();
  });
  async function command(action, values = {}) {
    try {
      const result = await request(base + '/calibration', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action, token, ...values }) });
      accept(result);
      return result;
    } catch (error) {
      if (error.data?.token) accept(error.data);
      throw error;
    }
  }
  function schedule() {
    if (timer !== null || !active || closed) return;
    timer = setTimeout(async () => {
      timer = null;
      try { await command('heartbeat'); }
      catch (error) { runStatus.textContent = error.message + ' If steaming, use the machine’s stop control.'; }
      finally { schedule(); }
    }, 500);
  }
  function accept(value) {
    sessionPhase = value.phase;
    token = value.token ?? token; active = value.active === true;
    runStatus.textContent = value.message || ({ armed: 'Ready to start.', starting: 'Waiting for steam to start…', heating: 'Heating — counter will start when steam flows.', steaming: 'Stop when the milk reaches your desired temperature.', restoring: 'Restoring previous steam settings…' }[value.phase] ?? value.phase);
    elapsed.textContent = 'Steaming: ' + Number(value.seconds || 0).toFixed(1) + ' s';
    if (value.result && !appliedResult) {
      appliedResult = true; captured = null;
      field('referenceMilkGrams').value = value.result.milkGrams;
      field('referenceSeconds').value = value.result.seconds;
      field('referenceFlow').value = value.result.flow;
      runStatus.textContent = 'Measured ' + value.result.milkGrams + ' g milk in ' + value.result.seconds + ' s at ' + value.result.flow + ' ml/s. Review, then Save calibration, or capture fresh milk to try again.';
    }
    paint(); schedule();
    if (returnAfterRestore && !active) { closed = true; window.location.assign(back.href); }
  }
  const prepare = button('Prepare calibration', actions, async () => {
    if (!captured) throw new Error('Capture the pitcher and milk weight first.');
    pending = true; appliedResult = false; paint();
    try {
      const heaterTemperature = Number(new URL(window.location.href).searchParams.get('steamHeaterTemperature'));
      await command('begin', { ...captured, flow: Number(field('referenceFlow').value),
        ...(Number.isInteger(heaterTemperature) && heaterTemperature >= 135 && heaterTemperature <= 165 ? { heaterTemperature } : {}) });
    } finally {
      pending = false; paint();
      if (returnAfterRestore && active) await command('cancel');
    }
  });
  const start = button('Start steam', actions, () => command('start'));
  const stop = button('Stop steam', actions, () => command('stop'));
  const cancel = button('Cancel calibration', actions, () => command('cancel'));
  start.disabled = true; stop.disabled = true;
  function paint() {
    const locked = active || pending;
    for (const key of Object.keys(labels)) field(key).disabled = locked;
    if (!locked) updateChoices();
    for (const control of [tarePitchers, tareMilk, ...captureButtons, captureMilk, pitcher]) control.disabled = locked || tarePending;
    prepare.disabled = locked || !captured;
    cancel.disabled = !active;
    save.disabled = locked;
    start.disabled = pending || !active || sessionPhase !== 'armed';
    stop.disabled = !active || ['restoring', 'preparing', 'armed'].includes(sessionPhase);
  }
  function updatePitchers() {
    const previous = pitcher.value;
    pitcher.replaceChildren();
    for (const size of sizes) {
      const grams = Number(field(size + 'JugGrams').value);
      if (!(grams >= 1 && grams <= 3000)) continue;
      const option = make('option', size[0].toUpperCase() + size.slice(1) + ' (' + grams + ' g)'); option.value = size; pitcher.append(option);
    }
    if (sizes.includes(previous) && Number(field(previous + 'JugGrams').value) >= 1) pitcher.value = previous;
    paint();
  }
  form.addEventListener('input', event => {
    if (event.target === pitcher || event.target?.name?.endsWith('JugGrams')) { clearCapture(); updatePitchers(); }
    if (appliedResult && event.target === field('referenceFlow')) {
      appliedResult = false; field('referenceSeconds').value = '';
      runStatus.textContent = 'Flow changed. Repeat calibration or enter a time measured at this flow.';
    }
  });
  pitcher.addEventListener('change', () => { clearCapture(); paint(); });
  back.addEventListener('click', async event => {
    if (!active && !pending) return;
    event.preventDefault(); returnAfterRestore = true;
    if (pending) return;
    try { await command('cancel'); } catch (error) { status.textContent = error.message; }
  });
  function connectScale() {
    if (closed) return;
    const url = new URL('/ws/v1/scale/snapshot', window.location.href);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    scaleSocket = new WebSocket(url.href);
    scaleSocket.onmessage = event => {
      let data; try { data = JSON.parse(event.data); } catch { return; }
      if (data.status === 'disconnected' || data.status === 'connected') {
        samples = []; zeroConfirmed = false; awaitingZero = false;
        if (!active) clearCapture();
        scaleValue.textContent = data.status === 'connected' ? 'Scale connected. Tare the empty scale before capture.' : 'Scale disconnected. Reconnect and tare the empty scale before capture.'; paint(); return;
      }
      if (!Number.isFinite(data.weight) || tarePending) return;
      const now = Date.now();
      samples.push({ weight: data.weight, at: now }); samples = samples.filter(s => now - s.at <= 2500).slice(-64);
      if (awaitingZero) {
        try {
          if (Math.abs(captureWeight(samples, now)) <= 0.5) {
            awaitingZero = false; zeroConfirmed = true; samples = [];
            scaleValue.textContent = 'Scale zeroed. Now place your pitcher on the scale.';
          }
        } catch {}
      } else scaleValue.textContent = 'Scale: ' + data.weight.toFixed(1) + ' g' + (zeroConfirmed ? '' : ' — tare the empty scale before capture.');
    };
    scaleSocket.onclose = () => {
      samples = []; zeroConfirmed = false; awaitingZero = false;
      if (!active) clearCapture();
      scaleValue.textContent = 'Scale connection lost. Reopen settings to reconnect, or enter weights manually.'; paint();
    };
  }
  window.addEventListener('pagehide', () => {
    closed = true;
    if (timer !== null) clearTimeout(timer);
    scaleSocket?.close();
    if (active && token) fetch(base + '/calibration', { method: 'POST', keepalive: true, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'cancel', token }) }).catch(() => {});
  });
  updatePitchers();
  connectScale();
  return { assertCanSave() { if (active || pending) throw new Error('Finish or cancel calibration before saving.'); } };
}

function settingsBrowser(resolveReturnUrl, mountCalibration, captureWeight) {
  const base = '/api/v1/plugins/calibrated-steam.reaplugin';
  const form = document.getElementById('settings');
  const status = document.getElementById('status');
  const save = document.getElementById('save');
  const back = document.getElementById('return-settings');
  back.href = resolveReturnUrl(window.location.href, document.referrer);
  let schema = {};
  let guided = null;
  async function request(path, options) {
    const response = await fetch(path, options);
    const text = await response.text();
    let data;
    try { data = text ? JSON.parse(text) : {}; } catch { data = {}; }
    if (!response.ok) throw Object.assign(new Error(data.message || data.error || (data.errors || []).map(error => error.message).join(' ') || 'Request failed.'), { data });
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
      guided = mountCalibration({ form, labels, save, back, status, request, base, field, updateChoices }, captureWeight);
    } catch (error) { status.textContent = error.message; }
  }
  form.addEventListener('submit', async event => {
    event.preventDefault();
    save.disabled = true;
    try {
      guided?.assertCanSave();
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
<style>:root{color-scheme:light dark;font:18px system-ui,sans-serif}body{max-width:850px;margin:auto;padding:24px;background:Canvas;color:CanvasText}h1{font-size:28px}p{line-height:1.5}fieldset{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:22px;border:1px solid GrayText;border-radius:8px;padding:20px}legend{font-weight:600}fieldset[hidden]{display:none}form{display:grid;grid-template-columns:1fr;gap:22px}label{display:flex;flex-direction:column;gap:8px}label span{font-weight:600}small{opacity:.8;line-height:1.4}input,select,button{font:inherit;padding:12px;border:1px solid GrayText;border-radius:8px;color:CanvasText;background:Canvas}input[type=checkbox]{width:28px;height:28px}button{cursor:pointer;min-height:48px}#status{min-height:2em}a{color:LinkText}#return-settings{display:inline-block;padding:14px 18px;border:1px solid GrayText;border-radius:8px;text-decoration:none}.full-width{grid-column:1/-1}.guided-calibration{display:block}.calibration-actions{display:flex;flex-wrap:wrap;gap:12px}.calibration-timer{font-size:28px;font-variant-numeric:tabular-nums}button:disabled{opacity:.5;cursor:default}footer{margin-top:28px;font-size:15px}</style></head><body>
<a id="return-settings" href="/api/v1/plugins/settings.reaplugin/ui">Return to settings</a>
<h1>Auto Steam Calculator</h1><p>Measure how long a known weight of milk takes to reach your preferred temperature. Use similar starting milk temperature, milk type and steaming technique each time. The timer estimates the result; it does not read milk temperature.</p>
<p>Enter at least one empty pitcher weight. Leave unused sizes blank or 0; only configured sizes appear in the steam controls. Choose a starting pitcher selection; the skin can remember subsequent selections.</p>
<p>Enable <strong>Offer Auto pitcher selection</strong> if you want automatic detection. Then enter your usual milk per drink and the pitcher normally used for one drink. Damian’s detection thresholds require all three pitcher weights and <strong>gross</strong> scale weight (pitcher plus milk, without taring). With Auto detection disabled, you can configure just the sizes you use. <strong>Tared</strong> mode uses milk weight only and does not subtract the pitcher.</p>
<p>Use guided calibration below to capture pitcher weights and measure a steam run, or enter a milk-only weight and time measured separately. Set the flow before preparing calibration. Auto steam mode applies that flow with each calculated time. Use the same normal steam heater setting; the calculator does not compensate for changes to heater or starting milk temperature.</p><form id="settings"></form><p id="status" role="status" aria-live="polite">Loading settings…</p><button id="save" form="settings" type="submit" disabled>Save calibration</button>
<footer>Calibration formula and automatic pitcher-selection heuristic inspired by <a href="https://github.com/Damian-AU/DSx2">Damian / Damian-AU’s DSx2</a>. JavaScript implementation for Decaid by pponce.</footer>
<script>(${settingsBrowser.toString()})(${settingsReturnUrl.toString()},${mountCalibrationPage.toString()},${captureScaleWeight.toString()});</script></body></html>`;
}

globalThis.createPlugin = function createPlugin() {
  let settings = {};
  let loaded = false;
  let calibration = null, calibrationToken = null, calibrationTimer = null, latestMachine = null, latestMachineAt = 0;
  const calibrationActive = () => calibration?.snapshot().active === true;
  async function machineRequest(path, method = 'GET', body) {
    const response = await fetch('http://localhost:8080/api/v1/' + path, {
      method, headers: { 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!response.ok) throw new Error('Machine request failed (' + response.status + ').');
    return method === 'GET' ? response.json() : null;
  }
  function scheduleCalibration() {
    if (calibrationTimer !== null || !loaded) return;
    calibrationTimer = setTimeout(async () => {
      calibrationTimer = null;
      try { await calibration?.tick(); }
      finally { if (calibrationActive()) scheduleCalibration(); }
    }, 250);
  }
  async function calibrationRequest(body) {
    if (!body || typeof body !== 'object') return json(400, { message: 'Supply a calibration action.' });
    try {
      if (body.action === 'begin') {
        if (calibrationActive()) return json(409, { message: 'Another calibration is active.' });
        calibration = createCalibrationSession({
          readWorkflow: () => machineRequest('workflow'),
          writeSteam: steamSettings => machineRequest('workflow', 'PUT', { steamSettings }),
          requestState: state => machineRequest('machine/state/' + state, 'PUT'),
        });
        if (latestMachine && Date.now() - latestMachineAt <= 3000) calibration.observe(latestMachine);
        calibrationToken = Date.now().toString(36) + Math.random().toString(36).slice(2);
        scheduleCalibration();
        await calibration.begin(body);
      } else {
        if (!calibration || body.token !== calibrationToken) return json(409, { message: 'This calibration session is no longer available.' });
        if (!['heartbeat', 'start', 'stop', 'cancel'].includes(body.action)) return json(400, { message: 'Unknown calibration action.' });
        calibration.heartbeat();
        await calibration[body.action]();
      }
      return json(200, { ...calibration.snapshot(), token: calibrationToken });
    } catch (error) {
      return json(409, { ...calibration?.snapshot(), token: calibrationToken, message: error.message });
    } finally { if (calibrationActive()) scheduleCalibration(); }
  }
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
    onUnload() {
      loaded = false; settings = {};
      if (calibrationTimer !== null) clearTimeout(calibrationTimer);
      calibrationTimer = null;
      if (calibrationActive()) calibration.cancel('Extension unloaded; calibration is incomplete.');
    },
    onEvent(event) {
      if (event.name !== 'stateUpdate') return;
      latestMachine = event.payload;
      latestMachineAt = Date.now();
      calibration?.observe(event.payload);
    },
    __httpRequestHandler(request) {
      if (!loaded) return json(503, { code: 'plugin_disabled', message: 'Enable the calibrated steam plugin.' });
      const { endpoint, method, body } = request;
      const methods = { status: 'GET', calculate: 'POST', validate: 'POST', ui: 'GET', calibration: 'POST' };
      if (!methods[endpoint]) return json(404, { code: 'not_found', message: 'Unknown endpoint.' });
      if (method !== methods[endpoint]) return json(405, { code: 'method_not_allowed', message: `Use ${methods[endpoint]}.` });
      if (endpoint === 'calibration') return calibrationRequest(body);
      if (endpoint === 'status') return json(200, { apiVersion: 3, version: MANIFEST.version, calibrationActive: calibrationActive(), ready: validateSettings(settings).length === 0, settings, availablePitchers: availablePitchers(settings), errors: validateSettings(settings), schema: MANIFEST.settings });
      if (endpoint === 'ui') return { status: 200, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }, body: settingsPage() };
      if (endpoint === 'validate') {
        if (!body || typeof body !== 'object' || Array.isArray(body)) return json(400, { code: 'invalid_request', message: 'Settings must be an object.' });
        const errors = validateSettings(configured(body));
        return json(errors.length ? 422 : 200, { valid: errors.length === 0, errors });
      }
      if (calibrationActive()) return json(409, { code: 'calibration_active', message: 'Finish or cancel guided calibration first.' });
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
