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
