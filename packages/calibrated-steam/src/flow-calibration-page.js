function mountFlowCalibrationPage({ form, labels, field, updateChoices, syncFlow }, readReadings, suggestFlows, validReading) {
  const make = (tag, text) => { const element = document.createElement(tag); if (text) element.textContent = text; return element; };
  const panel = labels.referenceMilkGrams.closest('fieldset').parentElement;
  const manual = labels.referenceMilkGrams.closest('fieldset');
  const config = make('fieldset'); config.className = 'flow-setup'; config.append(make('legend', 'Calibration type'));
  const modes = make('div'); modes.className = 'calibration-actions full-width'; config.append(modes);
  const controls = [];
  const addButton = (text, parent, action, id) => {
    const button = make('button', text); button.type = 'button'; if (id) button.id = id;
    button.addEventListener('click', () => { try { action(); } catch (error) { notice.textContent = error.message; } });
    parent.append(button); controls.push(button); return button;
  };
  let readings = readReadings({ flowReadings: field('flowReadings').value }) || [];
  let multiple = field('calibrationMode').value === 'multiple';
  if (!multiple || readings.length < 2 || readings.length > 4) readings = [];
  let flows = readings.length ? readings.map(reading => reading?.flow) : [Number(field('referenceFlow').value)];
  let index = 0, locked = false, reviewing = false, guidedMode = false, guide = null, review = null, planValid = true;
  let clearGuided = () => {}, measurementReady = false;
  const single = addButton('Single flow', modes, () => setMode(false), 'flow-mode-single');
  const multi = addButton('Multiple flows', modes, () => setMode(true), 'flow-mode-multiple');
  const range = make('div'); range.className = 'field-grid full-width'; config.append(range);
  function input(label, value, type = 'number') {
    const wrapper = make('label', label); wrapper.className = 'field';
    const element = make(type === 'select' ? 'select' : 'input');
    if (type !== 'select') { element.type = type; element.step = '0.1'; element.min = '0.4'; element.max = '2.5'; }
    element.value = value; wrapper.append(element); controls.push(element);
    return { wrapper, element };
  }
  const minimum = input('Minimum flow (ml/s)', readings[0]?.flow ?? 0.4); minimum.element.id = 'flow-minimum';
  const maximum = input('Maximum flow (ml/s)', readings[readings.length - 1]?.flow ?? 2.5); maximum.element.id = 'flow-maximum';
  const count = input('Readings', readings.length || 3, 'select'); count.element.id = 'flow-reading-count';
  for (const n of [2, 3, 4]) { const option = make('option', n === 3 ? '3 · recommended' : String(n)); option.value = n; count.element.append(option); }
  count.element.value = readings.length || 3;
  range.append(minimum.wrapper, maximum.wrapper, count.wrapper);
  const recommendation = make('p', 'Choose 3 or 4 readings for a wider range or a better estimate between measured flows.'); recommendation.className = 'full-width'; range.append(recommendation);
  const flowSlot = make('div'); config.append(flowSlot);
  const temperature = field('targetTemperatureC');
  controls.push(temperature);
  config.append(labels.targetTemperatureC);
  const notice = make('p'); notice.className = 'local-status full-width'; notice.id = 'flow-calibration-status'; notice.setAttribute('role', 'status'); notice.setAttribute('aria-live', 'polite'); config.append(notice);
  panel.insertBefore(config, manual);
  const steps = make('div'); steps.className = 'calibration-actions'; steps.id = 'flow-reading-steps'; panel.insertBefore(steps, manual);
  const readingPanel = make('section'); readingPanel.id = 'flow-reading-panel'; panel.insertBefore(readingPanel, manual); readingPanel.append(manual);
  const heading = make('h2'); heading.id = 'flow-reading-title'; readingPanel.insertBefore(heading, manual);
  const instructions = make('p', 'Use fresh milk at the same starting temperature and the same pitcher for each reading. Stop at the same target milk temperature for every reading.'); readingPanel.insertBefore(instructions, manual);
  const methods = make('div'); methods.className = 'calibration-actions'; readingPanel.insertBefore(methods, manual);
  const manualButton = addButton('Enter measured time', methods, () => setMethod(false), 'flow-method-manual');
  const guidedButton = addButton('Guided calibration', methods, () => setMethod(true), 'flow-method-guided');
  const actions = make('div'); actions.className = 'calibration-actions'; panel.append(actions);
  const previous = addButton('Previous reading', actions, () => openReading(index - 1), 'flow-previous');
  const use = addButton('Use values and next', actions, useReading, 'flow-use-reading');
  const summary = make('fieldset'); summary.id = 'flow-review'; summary.append(make('legend', 'Review calibration')); panel.append(summary);
  const summaryRows = make('div'); summaryRows.className = 'full-width'; summary.append(summaryRows);
  function stored() {
    field('calibrationMode').value = multiple ? 'multiple' : 'single';
    field('flowReadings').value = JSON.stringify(multiple ? flows.map((flow, i) => readings[i] || { flow, milkGrams: 0, seconds: 0 }) : []);
    updateChoices();
  }
  function paint() {
    single.setAttribute('aria-pressed', String(!multiple)); multi.setAttribute('aria-pressed', String(multiple));
    range.hidden = !multiple;
    steps.hidden = !multiple || reviewing;
    heading.textContent = planValid ? 'Reading ' + (index + 1) + ' of ' + flows.length + ' · ' + currentFlow() + ' ml/s' : 'Choose a valid flow range';
    readingPanel.hidden = reviewing; actions.hidden = reviewing; summary.hidden = !reviewing;
    use.textContent = flows.every((flow, i) => i === index || validReading(readings[i])) ? 'Use values and review' : 'Use values and next';
    for (const control of controls) control.disabled = locked;
    previous.disabled = locked || index === 0;
    use.disabled = locked || !planValid || (guidedMode && !measurementReady);
    steps.replaceChildren();
    flows.forEach((flow, i) => {
      const button = make('button', flow + ' ml/s · ' + (validReading(readings[i]) ? 'Captured' : 'Pending'));
      button.type = 'button'; button.disabled = locked; button.setAttribute('aria-pressed', String(i === index && !reviewing));
      button.addEventListener('click', () => openReading(i)); steps.append(button);
    });
    if (guide && review) { guide.hidden = !guidedMode; review.hidden = guidedMode; review.open = true; }
    manualButton.setAttribute('aria-pressed', String(!guidedMode)); guidedButton.setAttribute('aria-pressed', String(guidedMode));
    summaryRows.replaceChildren();
    flows.forEach((flow, i) => {
      const row = make('div'); row.className = 'scale-tools';
      const reading = readings[i];
      const temperatureNote = Number(temperature.value) > 0 ? temperature.value + ' °C target' : 'Temperature target not noted';
      row.append(make('p', flow + ' ml/s · ' + (validReading(reading) ? reading.milkGrams + ' g · ' + reading.seconds + ' s · ' + temperatureNote : 'Not captured')));
      const edit = make('button', 'Edit'); edit.type = 'button'; edit.disabled = locked; edit.addEventListener('click', () => openReading(i)); row.append(edit); summaryRows.append(row);
    });
  }
  function currentFlow() { return !planValid ? NaN : multiple ? flows[index] : Number(field('referenceFlow').value); }
  function openReading(next) {
    if (locked || next < 0 || next >= flows.length) return;
    index = next; reviewing = false; measurementReady = false; clearGuided();
    const reading = readings[index];
    field('referenceMilkGrams').value = reading?.milkGrams || '';
    field('referenceSeconds').value = reading?.seconds || '';
    notice.textContent = 'Changes only apply after save.';
    paint();
  }
  function planFlows() {
    if (locked) return;
    try {
      const next = suggestFlows(Number(minimum.element.value), Number(maximum.element.value), Number(count.element.value));
      planValid = true; flows = next; readings = flows.map(() => null); stored(); openReading(0);
      notice.textContent = 'Capture ' + flows.length + ' readings. Use fresh milk for each flow.';
    } catch (error) {
      planValid = false; readings = []; field('flowReadings').value = '[]'; notice.textContent = error.message; updateChoices(); paint();
    }
  }
  function setMode(value) {
    if (locked || value === multiple) return;
    multiple = value; reviewing = false;
    if (multiple) planFlows();
    else { planValid = true; flows = [Number(field('referenceFlow').value)]; readings = [null]; field('referenceSeconds').value = ''; stored(); openReading(0); }
    stored(); paint();
  }
  function setMethod(value) {
    if (locked) return;
    guidedMode = value; paint();
  }
  function useReading() {
    if (locked || !planValid || (guidedMode && !measurementReady)) return;
    const reading = { flow: currentFlow(), milkGrams: Number(field('referenceMilkGrams').value), seconds: Number(field('referenceSeconds').value) };
    if (!validReading(reading)) throw new Error('Enter 10–1500 g of milk and 1–255 seconds measured at this flow.');
    readings[index] = reading; stored();
    const next = flows.findIndex((flow, i) => !validReading(readings[i]));
    if (next !== -1) openReading(next);
    else {
      reviewing = true;
      notice.textContent = 'Changes only apply after save.';
      paint();
    }
  }
  for (const element of [minimum.element, maximum.element, count.element]) element.addEventListener('change', planFlows);
  form.addEventListener('input', event => {
    if (event.target === temperature) paint();
    if (event.target === field('referenceMilkGrams') || event.target === field('referenceSeconds')) {
      readings[index] = null; stored();
      measurementReady = false; reviewing = false; paint();
    }
  });
  if (multiple && !readings.length) planFlows();
  if (!multiple) readings = [{ flow: currentFlow(), milkGrams: Number(field('referenceMilkGrams').value), seconds: Number(field('referenceSeconds').value) }];
  reviewing = readings.length === flows.length && readings.every(validReading);
  if (!reviewing) openReading(Math.max(0, readings.findIndex(reading => !validReading(reading))));
  notice.textContent = 'Changes only apply after save.';
  paint();
  return {
    currentFlow,
    attach(guided, measured, flowLabel, clear) {
      guide = guided; review = measured; clearGuided = clear; flowSlot.append(flowLabel); paint();
    },
    lock(value) { locked = value; paint(); },
    acceptMeasurement(result) {
      if (result.flow !== currentFlow()) throw new Error('The measurement flow changed. Repeat this reading.');
      field('referenceMilkGrams').value = result.milkGrams;
      field('referenceSeconds').value = result.seconds;
      readings[index] = null; stored();
      measurementReady = true; reviewing = false; paint();
    },
    flowChanged() {
      if (!multiple) { flows = [Number(field('referenceFlow').value)]; readings = [null]; field('referenceMilkGrams').value = ''; measurementReady = false; clearGuided(); reviewing = false; }
      paint();
    },
    reveal(key) { reviewing = false; if (['referenceMilkGrams', 'referenceSeconds'].includes(key)) guidedMode = false; paint(); },
    assertCanSave() {
      const temperatureTarget = Number(temperature.value);
      if (!Number.isFinite(temperatureTarget) || temperatureTarget < 0 || temperatureTarget > 100) throw Object.assign(new Error('Enter a target milk temperature between 0 and 100 °C, or leave the note blank.'), { field: 'targetTemperatureC' });
      if (multiple && (!planValid || flows.length < 2 || readings.length !== flows.length || !readings.every(validReading))) {
        reviewing = false; paint(); throw Object.assign(new Error('Complete and use every flow reading before saving.'), { field: 'flowReadings' });
      }
    },
  };
}
