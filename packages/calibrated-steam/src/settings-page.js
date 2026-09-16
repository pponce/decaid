function settingsBrowser(resolveReturnUrl, mountCalibration, captureWeight, pitcherChoices, validateConfiguration, mountFlowPlan) {
  const base = '/api/v1/plugins/calibrated-steam.reaplugin';
  const form = document.getElementById('settings');
  const status = document.getElementById('status');
  const save = document.getElementById('save');
  const back = document.getElementById('return-settings');
  const tabs = document.getElementById('settings-tabs');
  const summary = document.getElementById('configuration-summary');
  back.href = resolveReturnUrl(window.location.href, document.referrer);
  form.noValidate = true;
  let schema = {}, guided = null, loaded = false, flowValue = null, flowPlan = null;
  const panels = {}, tabButtons = {}, labels = {}, fieldPanels = {};
  const tabDefinitions = [['general', 'General'], ['pitchers', 'Pitchers & Auto'], ['calibration', 'Calibration'], ['instructions', 'Instructions'], ['glossary', 'Glossary']];
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
    if (fieldPanels[key] === 'calibration') flowPlan?.reveal(key);
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
    for (const key of ['singleDrinkGrams', 'singleDrinkPitcher']) field(key).required = current.autoDetect;
    const choices = pitcherChoices(current);
    const select = field('defaultPitcher'), previous = select.value;
    select.replaceChildren();
    if (!choices.length) {
      const option = make('option', 'Configure Pitchers & Auto first'); option.value = ''; select.append(option);
    }
    for (const choice of choices) {
      const option = make('option', choice === 'auto' ? 'Auto' : choice[0].toUpperCase() + choice.slice(1));
      option.value = choice; select.append(option);
    }
    select.value = choices.includes(previous) ? previous : (choices[0] || '');
    select.disabled = guided?.isActive() || choices.length === 0;
    const names = { small: 'S', medium: 'M', large: 'L', auto: 'Auto' };
    const missing = Object.keys(names).filter(key => !choices.includes(key));
    summary.replaceChildren(make('span', 'Configured: '));
    for (const choice of choices) {
      const badge = make('span', names[choice]);
      badge.className = 'configured-pitcher';
      summary.append(badge);
    }
    if (!choices.length) summary.append(make('span', 'none'));
    if (missing.length) summary.append(make('span', ' · Not configured: ' + missing.map(key => names[key]).join(', ')));
    const flow = Number(current.referenceFlow);
    summary.append(make('span', ' · Calibration: ' + (validateConfiguration(values()).length ? 'setup required' : 'ready') +
      (Number.isFinite(flow) && flow >= 0.4 && flow <= 2.5 ? ' · ' + flow.toFixed(1) + ' ml/s' : '')));
  }
  function syncFlow(value, measured = false) {
    const changed = Number(value) !== Number(flowValue);
    field('referenceFlow').value = value;
    const mirror = document.getElementById('calibration-flow');
    if (mirror) mirror.value = value;
    flowValue = String(value);
    if (changed && !measured && field('calibrationMode').value !== 'multiple') {
      field('referenceSeconds').value = '';
      status.textContent = 'Flow changed. Measure a new calibration time at this flow.';
      guided?.flowChanged();
    }
    if (changed) flowPlan?.flowChanged();
    updateChoices();
  }
  async function load() {
    try {
      const data = await request(base + '/status'); schema = data.schema;
      for (const [name, title] of tabDefinitions) {
        const button = make('button', title); button.type = 'button'; button.id = 'tab-' + name;
        button.setAttribute('role', 'tab'); button.setAttribute('aria-controls', 'panel-' + name);
        button.addEventListener('click', () => showTab(name));
        button.addEventListener('keydown', event => {
          const names = tabDefinitions.map(([key]) => key), index = names.indexOf(name);
          const next = event.key === 'ArrowRight' ? names[(index + 1) % names.length] : event.key === 'ArrowLeft' ? names[(index + names.length - 1) % names.length] : null;
          if (next) { event.preventDefault(); showTab(next); tabButtons[next].focus(); }
        });
        tabs.append(button); tabButtons[name] = button;
        const panel = make('section'); panel.id = 'panel-' + name; panel.setAttribute('role', 'tabpanel'); panel.setAttribute('aria-labelledby', button.id);
        form.append(panel); panels[name] = panel;
      }
      const groups = [
        ['general', 'General settings', ['referenceFlow', 'weightMode', 'defaultPitcher']],
        ['pitchers', 'Empty pitcher weights', ['smallPitcherGrams', 'mediumPitcherGrams', 'largePitcherGrams']],
        ['pitchers', 'Automatic pitcher selection', ['autoDetect', 'singleDrinkGrams', 'singleDrinkPitcher']],
        ['calibration', 'Manual calibration / measured values', ['targetTemperatureC', 'referenceMilkGrams', 'referenceSeconds']],
      ];
      const captions = { smallPitcherGrams: 'Small (g)', mediumPitcherGrams: 'Medium (g)', largePitcherGrams: 'Large (g)', referenceFlow: 'Steam flow (ml/s)', weightMode: 'Scale weight mode', defaultPitcher: 'Starting pitcher selection' };
      const hints = { smallPitcherGrams: 'Empty pitcher. Blank means unused.', mediumPitcherGrams: 'Empty pitcher. Blank means unused.', largePitcherGrams: 'Empty pitcher. Blank means unused.', referenceFlow: 'Shared with Calibration. Used for all Auto steaming.', weightMode: 'Gross: pitcher + milk. Tared: milk only.' };
      for (const [panelName, heading, keys] of groups) {
        const section = make('fieldset'); section.append(make('legend', heading)); panels[panelName].append(section);
        let automaticFields;
        if (keys.includes('autoDetect')) {
          automaticFields = make('div'); automaticFields.id = 'automatic-fields'; automaticFields.className = 'field-grid';
        }
        for (const key of keys) {
          const item = schema[key]; if (!item) continue;
          const wrapper = make('div'); wrapper.className = key.endsWith('PitcherGrams') ? 'field pitcher-field' : 'field';
          const label = make('label', captions[key] || item.label); label.htmlFor = 'setting-' + key; wrapper.append(label);
          const input = make(item.type === 'enum' ? 'select' : 'input'); input.name = key; input.id = 'setting-' + key;
          if (item.type === 'enum') {
            for (const choice of item.values) { const option = make('option', choice || 'Choose a pitcher'); option.value = choice; input.append(option); }
          } else if (item.type === 'boolean') { input.type = 'checkbox'; input.checked = data.settings[key] === true; }
          else {
            input.type = 'number'; input.step = 'any'; input.inputMode = 'decimal'; input.min = '0';
            if (key === 'referenceFlow') { input.min = '0.4'; input.max = '2.5'; input.step = '0.1'; }
            if (key === 'targetTemperatureC') { input.max = '100'; input.placeholder = 'Optional'; }
          }
          if (item.type !== 'boolean') input.value = item.type === 'number' && data.settings[key] === 0 ? '' : data.settings[key];
          wrapper.append(input); wrapper.append(make('small', hints[key] || item.description));
          if (automaticFields && key !== 'autoDetect') automaticFields.append(wrapper); else section.append(wrapper);
          labels[key] = wrapper; fieldPanels[key] = panelName;
        }
        if (automaticFields) section.append(automaticFields);
      }
      const instructions = [
        ['1 · Configure pitchers', 'In Pitchers & Auto, enter at least one empty pitcher weight. To measure it, tare the empty scale, wait for stable zero, place the empty pitcher, then select its Set from scale button. The first configured pitcher becomes the starting selection; change it in General if desired.'],
        ['2 · Choose how milk is weighed', 'General offers Gross (pitcher + milk) or Tared (milk only). For automatic pitcher selection, use Gross and configure all three pitcher weights, usual milk per drink and the Small or Medium pitcher normally used for one drink. Only configured choices appear on the shot page.'],
        ['3 · Plan calibration', 'Choose Single flow for a fixed Auto flow, or Multiple flows for adjustment within a measured range. Select 2–4 readings; 3 or 4 are recommended for wider ranges. Optionally note your target milk temperature. Use fresh milk, the same pitcher, starting temperature, heater setting and technique for every reading. Aim for the same target milk temperature throughout the set. Record the actual milk-only weight for each reading.'],
        ['4 · Measure manually or with guidance', 'For manual entry, steam at the flow shown for that reading and enter the actual milk-only weight and measured steaming time. For guided entry, tare the empty scale, wait for zero, place the pitcher with milk, and capture. Prepare calibration applies the reading’s flow. Start steam, then stop at your target milk temperature. The counter excludes warm-up. Guided calibration always subtracts the chosen pitcher from gross weight.'],
        ['5 · Review and save', 'Use values and next moves through unfinished readings. Use values and review shows the compact summary. Edit any reading to adjust values or run a new guided calibration. Saved readings reopen in the compact view. Changes only apply after save; leaving without saving discards edits. Changing the planned flow range or reading count clears the draft readings.'],
        ['6 · Make a drink', 'Select Auto in the shot-page steam controls, weigh the filled pitcher and tap its S, M, L or Auto preset. Tapping the same preset again recalculates for the new milk. Check the calculated time before starting steam. Single flow is fixed; multiple-flow calibration allows flow changes within its measured range, followed by a new calculation. Manual Flow and Time remain available. Off reminds you to calculate; it is not a hard start interlock.'],
      ];
      for (const [heading, text] of instructions) {
        const section = make('section'); section.className = 'help-section';
        section.append(make('h2', heading), make('p', text)); panels.instructions.append(section);
      }
      const glossary = make('dl'); glossary.className = 'glossary';
      const glossaryKeys = ['referenceFlow', 'weightMode', 'defaultPitcher', 'smallPitcherGrams', 'mediumPitcherGrams', 'largePitcherGrams', 'autoDetect', 'singleDrinkGrams', 'singleDrinkPitcher', 'calibrationMode', 'targetTemperatureC', 'referenceMilkGrams', 'referenceSeconds'];
      for (const key of glossaryKeys) glossary.append(make('dt', schema[key].label), make('dd', schema[key].description));
      for (const [term, meaning] of [
        ['Minimum / maximum flow', 'Lowest and highest flows you will measure. Auto can interpolate only inside this range. Changing the range clears draft readings.'],
        ['Readings', 'Two measures both endpoints; three adds a midpoint; four adds two spaced interior flows. Each uses fresh milk. Changing the count clears draft readings.'],
        ['Configured / calibration ready', 'Green badges identify available pitcher choices. Calibration readiness also requires valid measured values and general settings.'],
        ['Tare / capture', 'Tare zeros an empty scale. Capture records its fresh, stable weight; it does not tare. During guided calibration, capture subtracts the configured empty pitcher weight.'],
        ['Use values / Save calibration', 'Use values accepts a reading into the current draft. Save calibration applies the entire configuration and returns to settings.'],
      ]) glossary.append(make('dt', term), make('dd', meaning));
      panels.glossary.append(glossary);
      for (const key of ['calibrationMode', 'flowReadings']) {
        const input = make('input'); input.type = 'hidden'; input.name = key; input.value = data.settings[key];
        form.append(input); fieldPanels[key] = 'calibration';
      }
      flowValue = String(field('referenceFlow').value);
      form.addEventListener('input', event => {
        if (event.target === field('referenceFlow')) syncFlow(event.target.value);
        else updateChoices();
      });
      form.addEventListener('change', updateChoices);
      updateChoices(); showTab('general'); loaded = true; save.disabled = false;
      status.textContent = data.ready ? 'Calibration is ready.' : 'Configure a pitcher and calibration before using Auto steam.';
      flowPlan = mountFlowPlan({ form, labels, field, updateChoices, syncFlow }, readFlowReadings, proposedFlows, validFlowReading);
      guided = mountCalibration({ form, labels, save, back, status, request, base, field, updateChoices, syncFlow, flowPlan }, captureWeight);
    } catch (error) { status.textContent = error.message; }
  }
  form.addEventListener('submit', async event => {
    event.preventDefault(); if (!loaded) return;
    save.disabled = true;
    try {
      guided?.assertCanSave();
      flowPlan?.assertCanSave();
      const errors = validateConfiguration(values());
      if (errors.length) { reveal(errors[0].field); throw new Error(errors.map(error => error.message).join(' ')); }
      const options = { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(values()) };
      await request(base + '/validate', options); await request(base + '/settings', options);
      window.location.assign(back.href);
    } catch (error) {
      if (error.data?.errors?.length) reveal(error.data.errors[0].field);
      if (error.field) reveal(error.field);
      status.textContent = error.message;
    } finally { save.disabled = guided?.isActive() || false; }
  });
  load();
}

function settingsPage() {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Auto Steam Calculator</title>
<style>
:root{color-scheme:light dark;--bg:#f3f5f9;--surface:#fff;--text:#26334a;--muted:#526179;--border:#ccd5e2;--accent:#385a92;--notice:#eef3fb;--configured-bg:#def4e4;--configured-text:#24533a;font:14px/1.45 system-ui,sans-serif}
@media(prefers-color-scheme:dark){:root{--bg:#172132;--surface:#202b3e;--text:#e4eaf4;--muted:#b6c1d4;--border:#465166;--accent:#456faf;--notice:#2c3c55;--configured-bg:#234136;--configured-text:#bde4ca}}
*{box-sizing:border-box}body{max-width:940px;margin:auto;padding:16px;background:var(--bg);color:var(--text)}header{display:flex;gap:14px;align-items:center;flex-wrap:wrap}h1{font-size:22px;font-weight:600;margin:0}h2{font-size:16px;margin:0}p{margin:10px 0}button,a,input,select{touch-action:manipulation}button,input,select{font:inherit;color:var(--text);background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:10px;min-height:44px}input,select{font-size:16px;min-width:0;width:100%}input[type=checkbox]{width:24px;height:24px;min-height:24px;accent-color:var(--accent)}button{cursor:pointer}button:disabled{opacity:.5;cursor:default}a{color:var(--accent)}#return-settings{display:inline-block;padding:10px 14px;min-height:44px;text-decoration:none;border:1px solid var(--border);border-radius:8px;background:var(--surface)}#configuration-summary{display:flex;align-items:center;flex-wrap:wrap;gap:8px;color:var(--muted);margin:12px 0}.configured-pitcher{display:inline-block;background:var(--configured-bg);color:var(--configured-text);padding:5px 10px;border-radius:7px}#settings-tabs{display:flex;gap:8px;flex-wrap:wrap;margin:12px 0}#settings-tabs [aria-selected=true],button[aria-pressed=true],#save{background:var(--accent);color:#fff;border-color:transparent}[hidden]{display:none!important}fieldset{border:1px solid var(--border);border-radius:10px;background:var(--surface);padding:14px;margin:0 0 14px;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}legend{font-size:16px;font-weight:600;padding:0 5px}.field{display:grid;gap:6px;align-content:start}.field label{font-weight:500}.field small{color:var(--muted)}.field-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px;grid-column:1/-1}.pitcher-field{grid-column:1/-1;grid-template-columns:95px minmax(90px,1fr) auto;align-items:center;border-top:1px solid var(--border);padding-top:12px}.pitcher-field small{grid-column:2/-1}.pitcher-field .capture-button{grid-column:3;grid-row:1}.pitcher-field .capture-result{grid-column:1/-1;margin:0}.full-width{grid-column:1/-1}.scale-tools{display:flex;align-items:center;gap:12px;justify-content:space-between;flex-wrap:wrap}.scale-tools p{margin:0}.local-status{background:var(--notice);padding:9px 11px;border-radius:6px;overflow-wrap:anywhere}.guided-calibration{display:block}.calibration-actions{display:flex;flex-wrap:wrap;gap:10px;margin:12px 0}.calibration-timer{font-size:28px;font-variant-numeric:tabular-nums}.calibration-flow{max-width:220px;margin-bottom:12px}.guided-step{padding:12px 0;border-top:1px solid var(--border)}#status{min-height:1.5em;overflow-wrap:anywhere}.save-row{display:flex;align-items:center;gap:14px;justify-content:space-between;flex-wrap:wrap}footer{font-size:12px;color:var(--muted);margin-top:14px}details{margin-top:12px}summary{cursor:pointer;min-height:44px;padding:10px 0}
.help-section{padding:14px;border:1px solid var(--border);border-radius:10px;background:var(--surface);margin-bottom:12px}.help-section p{margin-bottom:0}.glossary{margin:0;background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:14px}.glossary dt{font-weight:600;margin-top:14px}.glossary dt:first-child{margin-top:0}.glossary dd{margin:4px 0 12px;color:var(--muted)}#flow-review .scale-tools{padding:8px 0}
@media(max-width:480px){body{padding:12px}fieldset,.field-grid{grid-template-columns:1fr}.pitcher-field{grid-template-columns:65px minmax(60px,1fr)}.pitcher-field .capture-button{grid-column:2;grid-row:auto}.pitcher-field small{grid-column:1/-1}}
</style></head><body>
<header><a id="return-settings" href="/api/v1/plugins/settings.reaplugin/ui">← Settings</a><h1>Auto Steam Calculator</h1></header>
<p id="configuration-summary" role="status" aria-live="polite">Loading configuration…</p>
<nav id="settings-tabs" role="tablist" aria-label="Auto Steam settings"></nav>
<form id="settings" novalidate></form>
<div class="save-row"><p id="status" role="status" aria-live="polite">Loading settings…</p><button id="save" form="settings" type="submit" disabled>Save calibration</button></div>
<footer>Calculation and automatic pitcher detection inspired by <a href="https://github.com/Damian-AU/DSx2">Damian / Damian-AU’s DSx2</a>. Implementation for Decaid by pponce.</footer>
<script>{${readFlowReadings.toString()}\n${validFlowReading.toString()}\n${validateFlowCalibration.toString()}\n${proposedFlows.toString()}\n${configuredPitchers.toString()}\n${availablePitchers.toString()}\n${validateSettings.toString()}\n(${settingsBrowser.toString()})(${settingsReturnUrl.toString()},${mountCalibrationPage.toString()},${captureScaleWeight.toString()},availablePitchers,validateSettings,${mountFlowCalibrationPage.toString()});}</script></body></html>`;
}
