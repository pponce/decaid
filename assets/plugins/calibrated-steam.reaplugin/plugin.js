/* Calibrated Steam Timer. GPL-3.0-only. Inspired by Damian / Damian-AU, DSx2. */
(function () {
"use strict";
const MANIFEST = {"id":"calibrated-steam.reaplugin","name":"Auto Steam Calculator","author":"pponce; calculation and pitcher heuristic inspired by Damian / Damian-AU (DSx2)","description":"Estimate steam duration from milk weight using your calibration. Inspired by Damian's DSx2 calculator. This estimates temperature through time; it does not measure milk temperature.","version":"0.6.0","apiVersion":1,"permissions":["api","events.machine"],"settings":{"smallJugGrams":{"type":"number","label":"Small empty pitcher (g)","description":"Untared weight of the empty small pitcher. Leave blank or 0 if not configured.","default":0},"mediumJugGrams":{"type":"number","label":"Medium empty pitcher (g)","description":"Untared weight of the empty medium pitcher. Leave blank or 0 if not configured.","default":0},"largeJugGrams":{"type":"number","label":"Large empty pitcher (g)","description":"Untared weight of the empty large pitcher. Leave blank or 0 if not configured.","default":0},"singleDrinkGrams":{"type":"number","label":"Usual milk per drink (g)","description":"Milk only for one drink; used to infer pitcher size in Auto. This can differ from your calibration milk weight.","default":0},"singleDrinkJug":{"type":"enum","label":"Pitcher normally used for one drink","description":"Select small or medium to choose the pitcher-detection thresholds.","values":["","small","medium"],"default":""},"weightMode":{"type":"enum","label":"Scale weight mode","description":"Gross includes the empty pitcher. Tared is milk only: pitcher size cannot be inferred and no pitcher weight is subtracted.","values":["gross","tared"],"default":"gross"},"referenceMilkGrams":{"type":"number","label":"Calibration milk weight (g)","description":"Milk only, excluding the pitcher, from your measured calibration run.","default":0},"referenceSeconds":{"type":"number","label":"Time to your desired milk temperature (s)","description":"Actual steaming time in the calibration run. Use similar milk, starting temperature and steaming technique for subsequent drinks.","default":0},"referenceFlow":{"type":"number","label":"Auto steam flow (ml/s)","description":"Flow used for calibration and applied in Auto steam mode. Configurable from 0.4 to 2.5 ml/s; default 0.4 ml/s. Recalibrate the time if you change this flow.","default":0.4},"defaultJug":{"type":"enum","label":"Starting pitcher selection","description":"Small, Medium or Large subtracts that pitcher weight. Auto guesses the pitcher using milk per drink. Streamline remembers subsequent preset selections.","values":["small","medium","large","auto"],"default":"small"},"autoDetect":{"type":"boolean","label":"Offer Auto pitcher selection","description":"Enable automatic detection using Damian’s heuristic. Requires all three pitcher weights, gross scale weight, usual milk per drink and the pitcher normally used for one drink.","default":false}},"api":[{"id":"status","type":"http","data":{}},{"id":"calculate","type":"http","data":{}},{"id":"validate","type":"http","data":{}},{"id":"ui","type":"http","data":{}},{"id":"calibration","type":"http","data":{}}]};
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
  const pitcherLabel = tared ? 'milk only' : jug[0].toUpperCase() + jug.slice(1) + ' pitcher';
  if (milkGrams < 10) fail('invalid_milk_weight', 'Milk < 10 g · ' + pitcherLabel);
  if (milkGrams > 1500) fail('invalid_milk_weight', 'Milk > 1500 g · ' + pitcherLabel);
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

function mountCalibrationPage({ form, labels, save, back, status, request, base, field, updateChoices, syncFlow }, captureWeight) {
  const sizes = ['small', 'medium', 'large'];
  let samples = [], zeroConfirmed = false, awaitingZero = false, tarePending = false;
  let captured = null, token = null, active = false, pending = false, timer = null, closed = false;
  let sessionPhase = 'idle';
  let returnAfterRestore = false, appliedResult = false, scaleSocket = null;
  const make = (tag, text) => { const element = document.createElement(tag); if (text) element.textContent = text; return element; };
  const button = (text, parent, action, feedback) => {
    const element = make('button', text); element.type = 'button'; parent.append(element);
    element.addEventListener('click', async () => {
      try { await action(); } catch (error) { (feedback || runStatus).textContent = error.message; }
    });
    return element;
  };
  const weights = labels.smallJugGrams.closest('fieldset');
  const scaleBox = make('div'); scaleBox.className = 'full-width';
  const scaleTools = make('div'); scaleTools.className = 'scale-tools';
  const scaleValue = make('p', 'Scale disconnected. Manual entry is available.');
  const scaleHelp = make('p', 'Tare with nothing on the scale. Wait for zero, then place an empty pitcher.');
  scaleHelp.className = 'local-status'; scaleHelp.setAttribute('role', 'status');
  scaleTools.append(scaleValue); scaleBox.append(scaleTools, scaleHelp);
  weights.insertBefore(scaleBox, labels.smallJugGrams);
  const guided = make('fieldset'); guided.className = 'guided-calibration';
  guided.append(make('legend', 'Guided calibration'));
  const flowLabel = make('label', 'Steam flow (ml/s)'); flowLabel.className = 'field calibration-flow';
  const flow = make('input'); flow.id = 'calibration-flow'; flow.type = 'number'; flow.min = '0.4'; flow.max = '2.5'; flow.step = '0.1'; flow.value = field('referenceFlow').value;
  flow.addEventListener('input', () => syncFlow(flow.value)); flowLabel.append(flow); guided.append(flowLabel);
  const weighStep = make('div'); weighStep.className = 'guided-step'; weighStep.append(make('h2', '1 · Weigh the milk'));
  const pitcherLabel = make('label', 'Calibration pitcher'); pitcherLabel.className = 'field';
  const pitcher = make('select'); pitcher.setAttribute('aria-label', 'Calibration pitcher'); pitcherLabel.append(pitcher); weighStep.append(pitcherLabel);
  const milkTools = make('div'); milkTools.className = 'scale-tools';
  const calibrationScaleValue = make('p', 'Scale disconnected.'); milkTools.append(calibrationScaleValue); weighStep.append(milkTools);
  weighStep.append(make('p', 'Tare empty → place pitcher with milk → capture.'));
  const milkActions = make('div'); milkActions.className = 'calibration-actions'; weighStep.append(milkActions);
  const milk = make('p', 'Choose a configured pitcher, then capture pitcher + milk.'); milk.className = 'local-status'; milk.setAttribute('role', 'status'); milk.setAttribute('aria-live', 'polite');
  weighStep.append(milk); guided.append(weighStep);
  const steamStep = make('div'); steamStep.className = 'guided-step'; steamStep.append(make('h2', '2 · Steam to your desired temperature'));
  const elapsed = make('p', 'Steaming: 0.0 s'); elapsed.className = 'calibration-timer'; steamStep.append(elapsed);
  const actions = make('div'); actions.className = 'calibration-actions'; steamStep.append(actions);
  const runStatus = make('p', 'Capture the milk weight to enable Prepare.'); runStatus.className = 'local-status';
  runStatus.setAttribute('role', 'status'); runStatus.setAttribute('aria-live', 'polite'); steamStep.append(runStatus); guided.append(steamStep);
  const help = make('details'); help.append(make('summary', 'Calibration tips'));
  help.append(make('p', 'Use cold milk and the same normal heater setting each time. Guided calibration always subtracts the selected pitcher from gross weight, even when everyday calculation uses Tared mode. Prepare applies your selected flow. Start and stop here or on the machine. Stop at your preferred milk temperature; warm-up is excluded. Review the measured values and save.'));
  guided.append(help);
  const manual = labels.referenceMilkGrams.closest('fieldset');
  const calibrationPanel = manual.parentElement;
  calibrationPanel.insertBefore(guided, manual);
  const review = make('details'); review.append(make('summary', 'Manual calibration / measured values'));
  calibrationPanel.insertBefore(review, manual); review.append(manual);
  function setScaleMessage(text) { scaleValue.textContent = text; calibrationScaleValue.textContent = text; }
  const captureButtons = [];
  function weight() {
    if (!zeroConfirmed || tarePending || awaitingZero) throw new Error('Tare the empty scale and wait for a stable zero first.');
    return captureWeight(samples, Date.now());
  }
  function clearCapture() {
    captured = null;
    milk.textContent = 'Choose a configured pitcher, then capture pitcher + milk.';
    if (!active && !pending) runStatus.textContent = 'Capture the milk weight to enable Prepare.';
  }
  async function tare() {
    if (active || pending) throw new Error('Finish or cancel calibration before taring.');
    zeroConfirmed = false; awaitingZero = false; tarePending = true; samples = []; clearCapture(); paint();
    try {
      await request('/api/v1/scale/tare', { method: 'PUT' });
      samples = []; awaitingZero = true;
      setScaleMessage('Keep the scale empty. Waiting for a stable zero…');
      scaleHelp.textContent = milk.textContent = 'Wait for a stable zero before placing the pitcher.';
    } finally { tarePending = false; paint(); }
  }
  const tarePitchers = button('Tare empty scale', scaleTools, tare, scaleHelp);
  for (const size of sizes) {
    const result = make('p'); result.className = 'capture-result'; result.setAttribute('role', 'status');
    const capture = button('Set from scale', labels[size + 'JugGrams'], () => {
      const value = weight();
      if (value < 1 || value > 3000) throw new Error('Place an empty pitcher on the scale (1–3000 g).');
      field(size + 'JugGrams').value = value;
      clearCapture(); updateChoices(); updatePitchers();
      result.textContent = size[0].toUpperCase() + size.slice(1) + ' pitcher set to ' + value + ' g.';
    }, result);
    capture.className = 'capture-button'; labels[size + 'JugGrams'].append(result); captureButtons.push(capture);
  }
  const tareMilk = button('Tare empty scale', milkTools, tare, milk);
  const captureMilk = button('Capture pitcher + milk', milkActions, () => {
    const size = pitcher.value, pitcherGrams = Number(field(size + 'JugGrams')?.value);
    if (!sizes.includes(size) || !(pitcherGrams >= 1 && pitcherGrams <= 3000)) throw new Error('Configure and choose a pitcher first.');
    const total = weight(), milkGrams = Math.round((total - pitcherGrams) * 10) / 10;
    const name = size[0].toUpperCase() + size.slice(1);
    if (milkGrams < 10) throw new Error('Milk < 10 g · ' + name + ' pitcher');
    if (milkGrams > 1500) throw new Error('Milk > 1500 g · ' + name + ' pitcher');
    captured = { pitcher: size, pitcherGrams, milkGrams };
    milk.textContent = total + ' g total − ' + pitcherGrams + ' g pitcher = ' + milkGrams + ' g milk. Captured.';
    runStatus.textContent = 'Ready to prepare at ' + field('referenceFlow').value + ' ml/s.';
    paint();
  }, milk);
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
      syncFlow(value.result.flow, true);
      review.open = true;
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
    flow.disabled = locked;
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
        setScaleMessage(data.status === 'connected' ? 'Scale connected. Tare the empty scale before capture.' : 'Scale disconnected. Reconnect and tare the empty scale before capture.'); paint(); return;
      }
      if (!Number.isFinite(data.weight) || tarePending) return;
      const now = Date.now();
      samples.push({ weight: data.weight, at: now }); samples = samples.filter(s => now - s.at <= 2500).slice(-64);
      if (awaitingZero) {
        try {
          if (Math.abs(captureWeight(samples, now)) <= 0.5) {
            awaitingZero = false; zeroConfirmed = true; samples = [];
            setScaleMessage('Scale: 0.0 g · Zero confirmed');
            scaleHelp.textContent = milk.textContent = 'Zero confirmed. Now place the pitcher on the scale.';
          }
        } catch {}
      } else {
        let stable = false;
        try { captureWeight(samples, now); stable = true; } catch {}
        setScaleMessage('Scale: ' + data.weight.toFixed(1) + ' g · ' + (stable ? 'Stable' : 'Settling…'));
        if (!zeroConfirmed) scaleHelp.textContent = milk.textContent = 'Tare the empty scale before capture.';
      }
    };
    scaleSocket.onclose = () => {
      samples = []; zeroConfirmed = false; awaitingZero = false;
      if (!active) clearCapture();
      setScaleMessage('Scale connection lost. Reopen settings to reconnect, or enter weights manually.'); paint();
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
  return { isActive: () => active || pending, flowChanged() { appliedResult = false; runStatus.textContent = 'Flow changed. Repeat calibration or enter a time measured at this flow.'; }, assertCanSave() { if (active || pending) throw new Error('Finish or cancel calibration before saving.'); } };
}

function settingsBrowser(resolveReturnUrl, mountCalibration, captureWeight, pitcherChoices, validateConfiguration) {
  const base = '/api/v1/plugins/calibrated-steam.reaplugin';
  const form = document.getElementById('settings');
  const status = document.getElementById('status');
  const save = document.getElementById('save');
  const back = document.getElementById('return-settings');
  const tabs = document.getElementById('settings-tabs');
  const summary = document.getElementById('configuration-summary');
  back.href = resolveReturnUrl(window.location.href, document.referrer);
  form.noValidate = true;
  let schema = {}, guided = null, loaded = false, flowValue = null;
  const panels = {}, tabButtons = {}, labels = {}, fieldPanels = {};
  const make = (tag, text) => { const element = document.createElement(tag); if (text) element.textContent = text; return element; };
  const field = key => form.elements.namedItem(key);
  const values = () => Object.fromEntries(Object.entries(schema).map(([key, item]) => {
    const input = field(key);
    return [key, item.type === 'boolean' ? input.checked : item.type === 'number' ? (input.value.trim() === '' ? 0 : Number(input.value)) : input.value];
  }));
  function showTab(name) {
    for (const key of Object.keys(panels)) {
      panels[key].hidden = key !== name;
      tabButtons[key].setAttribute('aria-selected', String(key === name));
      tabButtons[key].tabIndex = key === name ? 0 : -1;
    }
  }
  function reveal(key) {
    showTab(fieldPanels[key] || (key === 'pitchers' ? 'pitchers' : 'general'));
    const details = field(key)?.closest('details');
    if (details) details.open = true;
    field(key)?.focus();
  }
  async function request(path, options) {
    const response = await fetch(path, options);
    const text = await response.text();
    let data;
    try { data = text ? JSON.parse(text) : {}; } catch { data = {}; }
    if (!response.ok) throw Object.assign(new Error(data.message || data.error || (data.errors || []).map(error => error.message).join(' ') || 'Request failed.'), { data });
    return data;
  }
  function updateChoices() {
    const current = values();
    document.getElementById('automatic-fields').hidden = !current.autoDetect;
    for (const key of ['singleDrinkGrams', 'singleDrinkJug']) field(key).required = current.autoDetect;
    const choices = pitcherChoices(current);
    const select = field('defaultJug'), previous = select.value;
    select.replaceChildren();
    for (const choice of choices) {
      const option = make('option', choice === 'auto' ? 'Auto' : choice[0].toUpperCase() + choice.slice(1));
      option.value = choice; select.append(option);
    }
    select.value = choices.includes(previous) ? previous : (choices[0] || '');
    select.disabled = guided?.isActive() || choices.length === 0;
    const names = { small: 'S', medium: 'M', large: 'L', auto: 'Auto' };
    const missing = Object.keys(names).filter(key => !choices.includes(key));
    summary.textContent = 'Configured: ' + (choices.map(key => names[key]).join(', ') || 'none') +
      (missing.length ? ' · Not configured: ' + missing.map(key => names[key]).join(', ') : '') +
      ' · Calibration: ' + (validateConfiguration(values()).length ? 'setup required' : 'ready');
  }
  function syncFlow(value, measured = false) {
    const changed = Number(value) !== Number(flowValue);
    field('referenceFlow').value = value;
    const mirror = document.getElementById('calibration-flow');
    if (mirror) mirror.value = value;
    flowValue = String(value);
    if (changed && !measured) {
      field('referenceSeconds').value = '';
      status.textContent = 'Flow changed. Measure a new calibration time at this flow.';
      guided?.flowChanged();
    }
    updateChoices();
  }
  async function load() {
    try {
      const data = await request(base + '/status'); schema = data.schema;
      for (const [name, title] of [['general', 'General'], ['pitchers', 'Pitchers & Auto'], ['calibration', 'Calibration']]) {
        const button = make('button', title); button.type = 'button'; button.id = 'tab-' + name;
        button.setAttribute('role', 'tab'); button.setAttribute('aria-controls', 'panel-' + name);
        button.addEventListener('click', () => showTab(name));
        button.addEventListener('keydown', event => {
          const names = ['general', 'pitchers', 'calibration'], index = names.indexOf(name);
          const next = event.key === 'ArrowRight' ? names[(index + 1) % 3] : event.key === 'ArrowLeft' ? names[(index + 2) % 3] : null;
          if (next) { event.preventDefault(); showTab(next); tabButtons[next].focus(); }
        });
        tabs.append(button); tabButtons[name] = button;
        const panel = make('section'); panel.id = 'panel-' + name; panel.setAttribute('role', 'tabpanel'); panel.setAttribute('aria-labelledby', button.id);
        form.append(panel); panels[name] = panel;
      }
      const groups = [
        ['general', 'General settings', ['referenceFlow', 'weightMode', 'defaultJug']],
        ['pitchers', 'Empty pitcher weights', ['smallJugGrams', 'mediumJugGrams', 'largeJugGrams']],
        ['pitchers', 'Automatic pitcher selection', ['autoDetect', 'singleDrinkGrams', 'singleDrinkJug']],
        ['calibration', 'Manual calibration / measured values', ['referenceMilkGrams', 'referenceSeconds']],
      ];
      const captions = { smallJugGrams: 'Small (g)', mediumJugGrams: 'Medium (g)', largeJugGrams: 'Large (g)', referenceFlow: 'Steam flow (ml/s)', weightMode: 'Scale weight mode', defaultJug: 'Starting pitcher selection' };
      const hints = { smallJugGrams: 'Empty pitcher. Blank means unused.', mediumJugGrams: 'Empty pitcher. Blank means unused.', largeJugGrams: 'Empty pitcher. Blank means unused.', referenceFlow: 'Shared with Calibration. Used for all Auto steaming.', weightMode: 'Gross: pitcher + milk. Tared: milk only.' };
      for (const [panelName, heading, keys] of groups) {
        const section = make('fieldset'); section.append(make('legend', heading)); panels[panelName].append(section);
        let automaticFields;
        if (keys.includes('autoDetect')) {
          automaticFields = make('div'); automaticFields.id = 'automatic-fields'; automaticFields.className = 'field-grid';
        }
        for (const key of keys) {
          const item = schema[key]; if (!item) continue;
          const wrapper = make('div'); wrapper.className = key.endsWith('JugGrams') ? 'field pitcher-field' : 'field';
          const label = make('label', captions[key] || item.label); label.htmlFor = 'setting-' + key; wrapper.append(label);
          const input = make(item.type === 'enum' ? 'select' : 'input'); input.name = key; input.id = 'setting-' + key;
          if (item.type === 'enum') {
            for (const choice of item.values) { const option = make('option', choice || 'Choose a pitcher'); option.value = choice; input.append(option); }
          } else if (item.type === 'boolean') { input.type = 'checkbox'; input.checked = data.settings[key] === true; }
          else {
            input.type = 'number'; input.step = 'any'; input.inputMode = 'decimal'; input.min = '0';
            if (key === 'referenceFlow') { input.min = '0.4'; input.max = '2.5'; input.step = '0.1'; }
          }
          if (item.type !== 'boolean') input.value = item.type === 'number' && data.settings[key] === 0 ? '' : data.settings[key];
          wrapper.append(input); wrapper.append(make('small', hints[key] || item.description));
          if (automaticFields && key !== 'autoDetect') automaticFields.append(wrapper); else section.append(wrapper);
          labels[key] = wrapper; fieldPanels[key] = panelName;
        }
        if (automaticFields) section.append(automaticFields);
      }
      flowValue = String(field('referenceFlow').value);
      form.addEventListener('input', event => {
        if (event.target === field('referenceFlow')) syncFlow(event.target.value);
        else updateChoices();
      });
      form.addEventListener('change', updateChoices);
      updateChoices(); showTab('general'); loaded = true; save.disabled = false;
      status.textContent = data.ready ? 'Calibration is ready.' : 'Configure a pitcher and calibration before using Auto steam.';
      guided = mountCalibration({ form, labels, save, back, status, request, base, field, updateChoices, syncFlow }, captureWeight);
    } catch (error) { status.textContent = error.message; }
  }
  form.addEventListener('submit', async event => {
    event.preventDefault(); if (!loaded) return;
    save.disabled = true;
    try {
      guided?.assertCanSave();
      const errors = validateConfiguration(values());
      if (errors.length) { reveal(errors[0].field); throw new Error(errors.map(error => error.message).join(' ')); }
      const options = { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(values()) };
      await request(base + '/validate', options); await request(base + '/settings', options);
      window.location.assign(back.href);
    } catch (error) {
      if (error.data?.errors?.length) reveal(error.data.errors[0].field);
      status.textContent = error.message;
    } finally { save.disabled = guided?.isActive() || false; }
  });
  load();
}

function settingsPage() {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Auto Steam Calculator</title>
<style>
:root{color-scheme:light dark;--bg:#f3f5f9;--surface:#fff;--text:#26334a;--muted:#526179;--border:#ccd5e2;--accent:#385a92;--notice:#eef3fb;font:14px/1.45 system-ui,sans-serif}
@media(prefers-color-scheme:dark){:root{--bg:#172132;--surface:#202b3e;--text:#e4eaf4;--muted:#b6c1d4;--border:#465166;--accent:#456faf;--notice:#2c3c55}}
*{box-sizing:border-box}body{max-width:940px;margin:auto;padding:16px;background:var(--bg);color:var(--text)}header{display:flex;gap:14px;align-items:center;flex-wrap:wrap}h1{font-size:22px;font-weight:600;margin:0}h2{font-size:16px;margin:0}p{margin:10px 0}button,a,input,select{touch-action:manipulation}button,input,select{font:inherit;color:var(--text);background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:10px;min-height:44px}input,select{font-size:16px;min-width:0;width:100%}input[type=checkbox]{width:24px;height:24px;min-height:24px;accent-color:var(--accent)}button{cursor:pointer}button:disabled{opacity:.5;cursor:default}a{color:var(--accent)}#return-settings{display:inline-block;padding:10px 14px;min-height:44px;text-decoration:none;border:1px solid var(--border);border-radius:8px;background:var(--surface)}#configuration-summary{color:var(--muted);margin:12px 0}#settings-tabs{display:flex;gap:8px;flex-wrap:wrap;margin:12px 0}#settings-tabs [aria-selected=true],#save{background:var(--accent);color:#fff;border-color:transparent}[hidden]{display:none!important}fieldset{border:1px solid var(--border);border-radius:10px;background:var(--surface);padding:14px;margin:0 0 14px;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}legend{font-size:16px;font-weight:600;padding:0 5px}.field{display:grid;gap:6px;align-content:start}.field label{font-weight:500}.field small{color:var(--muted)}.field-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px;grid-column:1/-1}.pitcher-field{grid-column:1/-1;grid-template-columns:95px minmax(90px,1fr) auto;align-items:center;border-top:1px solid var(--border);padding-top:12px}.pitcher-field small{grid-column:2/-1}.pitcher-field .capture-button{grid-column:3;grid-row:1}.pitcher-field .capture-result{grid-column:1/-1;margin:0}.full-width{grid-column:1/-1}.scale-tools{display:flex;align-items:center;gap:12px;justify-content:space-between;flex-wrap:wrap}.scale-tools p{margin:0}.local-status{background:var(--notice);padding:9px 11px;border-radius:6px;overflow-wrap:anywhere}.guided-calibration{display:block}.calibration-actions{display:flex;flex-wrap:wrap;gap:10px;margin:12px 0}.calibration-timer{font-size:28px;font-variant-numeric:tabular-nums}.calibration-flow{max-width:220px;margin-bottom:12px}.guided-step{padding:12px 0;border-top:1px solid var(--border)}#status{min-height:1.5em;overflow-wrap:anywhere}.save-row{display:flex;align-items:center;gap:14px;justify-content:space-between;flex-wrap:wrap}footer{font-size:12px;color:var(--muted);margin-top:14px}details{margin-top:12px}summary{cursor:pointer;min-height:44px;padding:10px 0}
@media(max-width:480px){body{padding:12px}fieldset,.field-grid{grid-template-columns:1fr}.pitcher-field{grid-template-columns:65px minmax(60px,1fr)}.pitcher-field .capture-button{grid-column:2;grid-row:auto}.pitcher-field small{grid-column:1/-1}}
</style></head><body>
<header><a id="return-settings" href="/api/v1/plugins/settings.reaplugin/ui">← Settings</a><h1>Auto Steam Calculator</h1></header>
<p id="configuration-summary" role="status" aria-live="polite">Loading configuration…</p>
<nav id="settings-tabs" role="tablist" aria-label="Auto Steam settings"></nav>
<form id="settings" novalidate></form>
<div class="save-row"><p id="status" role="status" aria-live="polite">Loading settings…</p><button id="save" form="settings" type="submit" disabled>Save calibration</button></div>
<footer>Calculation and automatic pitcher detection inspired by <a href="https://github.com/Damian-AU/DSx2">Damian / Damian-AU’s DSx2</a>. Implementation for Decaid by pponce.</footer>
<script>{${configuredPitchers.toString()}\n${availablePitchers.toString()}\n${validateSettings.toString()}\n(${settingsBrowser.toString()})(${settingsReturnUrl.toString()},${mountCalibrationPage.toString()},${captureScaleWeight.toString()},availablePitchers,validateSettings);}</script></body></html>`;
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
