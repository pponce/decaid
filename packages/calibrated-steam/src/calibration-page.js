function mountCalibrationPage({ form, labels, save, back, status, request, base, field, updateChoices, syncFlow, flowPlan }, captureWeight) {
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
  const weights = labels.smallPitcherGrams.closest('fieldset');
  const scaleBox = make('div'); scaleBox.className = 'full-width';
  const scaleTools = make('div'); scaleTools.className = 'scale-tools';
  const scaleValue = make('p', 'Scale disconnected. Manual entry is available.');
  const scaleHelp = make('p', 'Tare with nothing on the scale. Wait for zero, then place an empty pitcher.');
  scaleHelp.className = 'local-status'; scaleHelp.setAttribute('role', 'status');
  scaleTools.append(scaleValue); scaleBox.append(scaleTools, scaleHelp);
  weights.insertBefore(scaleBox, labels.smallPitcherGrams);
  const guided = make('fieldset'); guided.className = 'guided-calibration';
  guided.append(make('legend', 'Guided calibration'));
  const flowLabel = make('label', 'Auto flow / default (ml/s)'); flowLabel.className = 'field calibration-flow';
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
    const capture = button('Set from scale', labels[size + 'PitcherGrams'], () => {
      const value = weight();
      if (value < 1 || value > 3000) throw new Error('Place an empty pitcher on the scale (1–3000 g).');
      field(size + 'PitcherGrams').value = value;
      clearCapture(); updateChoices(); updatePitchers();
      result.textContent = size[0].toUpperCase() + size.slice(1) + ' pitcher set to ' + value + ' g.';
    }, result);
    capture.className = 'capture-button'; labels[size + 'PitcherGrams'].append(result); captureButtons.push(capture);
  }
  const tareMilk = button('Tare empty scale', milkTools, tare, milk);
  const captureMilk = button('Capture pitcher + milk', milkActions, () => {
    const size = pitcher.value, pitcherGrams = Number(field(size + 'PitcherGrams')?.value);
    if (!sizes.includes(size) || !(pitcherGrams >= 1 && pitcherGrams <= 3000)) throw new Error('Configure and choose a pitcher first.');
    const total = weight(), milkGrams = Math.round((total - pitcherGrams) * 10) / 10;
    const name = size[0].toUpperCase() + size.slice(1);
    if (milkGrams < 10) throw new Error('Milk < 10 g · ' + name + ' pitcher');
    if (milkGrams > 1500) throw new Error('Milk > 1500 g · ' + name + ' pitcher');
    captured = { pitcher: size, pitcherGrams, milkGrams };
    milk.textContent = total + ' g total − ' + pitcherGrams + ' g pitcher = ' + milkGrams + ' g milk. Captured.';
    runStatus.textContent = 'Ready to prepare at ' + flowPlan.currentFlow() + ' ml/s.';
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
      flowPlan.acceptMeasurement(value.result);
      review.open = true;
      runStatus.textContent = 'Measured ' + value.result.milkGrams + ' g milk in ' + value.result.seconds + ' s at ' + value.result.flow + ' ml/s. Select Use values to continue, or capture fresh milk to try again.';
    }
    paint(); schedule();
    if (returnAfterRestore && !active) { closed = true; window.location.assign(back.href); }
  }
  const prepare = button('Prepare calibration', actions, async () => {
    if (!captured) throw new Error('Capture the pitcher and milk weight first.');
    pending = true; appliedResult = false; paint();
    try {
      const heaterTemperature = Number(new URL(window.location.href).searchParams.get('steamHeaterTemperature'));
      await command('begin', { ...captured, flow: flowPlan.currentFlow(),
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
    flowPlan.lock(locked);
    if (!locked) updateChoices();
    for (const control of [tarePitchers, tareMilk, ...captureButtons, captureMilk, pitcher]) control.disabled = locked || tarePending;
    prepare.disabled = locked || !captured || !Number.isFinite(flowPlan.currentFlow());
    cancel.disabled = !active;
    save.disabled = locked;
    start.disabled = pending || !active || sessionPhase !== 'armed';
    stop.disabled = !active || ['restoring', 'preparing', 'armed'].includes(sessionPhase);
  }
  function updatePitchers() {
    const previous = pitcher.value;
    pitcher.replaceChildren();
    for (const size of sizes) {
      const grams = Number(field(size + 'PitcherGrams').value);
      if (!(grams >= 1 && grams <= 3000)) continue;
      const option = make('option', size[0].toUpperCase() + size.slice(1) + ' (' + grams + ' g)'); option.value = size; pitcher.append(option);
    }
    if (sizes.includes(previous) && Number(field(previous + 'PitcherGrams').value) >= 1) pitcher.value = previous;
    paint();
  }
  form.addEventListener('input', event => {
    if (event.target === pitcher || event.target?.name?.endsWith('PitcherGrams')) { clearCapture(); updatePitchers(); }

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
  flowPlan.attach(guided, review, flowLabel, () => { clearCapture(); zeroConfirmed = false; samples = []; appliedResult = false; elapsed.textContent = 'Steaming: 0.0 s'; paint(); });
  updatePitchers();
  connectScale();
  return { isActive: () => active || pending, flowChanged() { appliedResult = false; runStatus.textContent = 'Flow changed. Repeat calibration or enter a time measured at this flow.'; }, assertCanSave() { if (active || pending) throw new Error('Finish or cancel calibration before saving.'); } };
}
