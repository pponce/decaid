import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../../../assets/plugins/calibrated-steam.reaplugin/plugin.js', import.meta.url), 'utf8');
const partial = { autoDetect: false, smallPitcherGrams: 0, mediumPitcherGrams: 220, largePitcherGrams: 0,
  defaultPitcher: 'medium', referenceMilkGrams: 150, referenceSeconds: 25,
  referenceFlow: 1.5 };

async function page(settings = partial, failSave = false, guidedRun = false) {
  const runtime = vm.createContext({});
  vm.runInContext(source, runtime);
  const plugin = runtime.createPlugin();
  plugin.onLoad(settings);
  const fields = {};
  let time = 10000;
  let socket;
  class FakeDate extends Date { static now() { return time; } }
  const timers = [];
  class FakeWebSocket { constructor() { socket = this; } close() {} }
  class Element {
    constructor(tag) { this.tag = tag; this.children = []; this.handlers = {}; this.value = ''; }
    set value(value) { this._value = String(value); }
    get value() { return this._value; }
    set name(value) { this.fieldName = value; fields[value] = this; }
    get name() { return this.fieldName; }
    set id(value) { this.elementId = value; ids[value] = this; }
    get id() { return this.elementId; }
    get parentElement() { return this.parent; }
    get textContent() { return this.children.length ? this.children.map(child => child.textContent).join('') : (this._textContent || ''); }
    set textContent(value) { this.children = []; this._textContent = value; }
    focus() { this.focused = true; }
    append(...children) { for (const child of children) { if (child.parent) child.parent.children = child.parent.children.filter(item => item !== child); this.children.push(child); child.parent = this; if (this.tag === 'select' && !this.value) this.value = child.value; } }
    replaceChildren(...children) { this.children = []; this._textContent = ''; this.value = ''; this.append(...children); }
    closest(tag) { return this.tag === tag ? this : this.parent?.closest(tag); }
    setAttribute(key, value) { this[key] = value; }
    insertBefore(child, before) { this.children.splice(this.children.indexOf(before), 0, child); child.parent = this; }
    addEventListener(event, handler) {
      const previous = this.handlers[event];
      this.handlers[event] = async (...args) => { await previous?.(...args); return handler(...args); };
    }
  }
  const ids = Object.fromEntries(['settings', 'status', 'save', 'return-settings', 'settings-tabs', 'configuration-summary'].map(id => [id, new Element(id === 'settings' ? 'form' : id)]));
  ids.settings.elements = { namedItem: key => fields[key] };
  const navigations = [];
  const calls = [];
  const calibrationCalls = [];
  const savedSettings = [];
  let session = null;
  const returnTo = 'http://localhost:43210/?page=settings';
  const document = { referrer: '', getElementById: id => ids[id], createElement: tag => new Element(tag) };
  const fetch = async (url, options = {}) => {
    const endpoint = url.split('/').at(-1);
    calls.push(endpoint);
    if (endpoint === 'calibration' && guidedRun) {
      const body = JSON.parse(options.body); calibrationCalls.push(body);
      if (body.action === 'begin') session = { active: true, phase: 'armed', token: 'page-test', seconds: 0, result: null, measurement: body };
      if (body.action === 'start') session = { ...session, phase: 'steaming', seconds: 0 };
      if (body.action === 'stop') session = { ...session, active: false, phase: 'complete', seconds: 25, result: { milkGrams: 160, flow: session.measurement.flow, seconds: 25 } };
      if (body.action === 'cancel') session = { ...session, active: false, phase: 'failed', message: 'Cancelled.', result: null };
      return { ok: true, text: async () => JSON.stringify(session) };
    }
    if (endpoint === 'tare') return { ok: true, text: async () => '' };
    if (endpoint === 'settings') {
      savedSettings.push(JSON.parse(options.body));
      if (failSave) throw new Error('Save failed');
      return { ok: true, text: async () => '{}'  };
    }
    const response = plugin.__httpRequestHandler({ endpoint, method: options.method ?? 'GET', body: options.body ? JSON.parse(options.body) : null });
    return { ok: response.status === 200, text: async () => response.body };
  };
  const body = plugin.__httpRequestHandler({ endpoint: 'ui', method: 'GET' }).body;
  const context = vm.createContext({ document, fetch, URL, Date: FakeDate, WebSocket: FakeWebSocket, setTimeout: callback => { timers.push(callback); return timers.length; }, clearTimeout: () => {}, window: { addEventListener() {}, location: {
    href: `http://localhost:8080/api/v1/plugins/calibrated-steam.reaplugin/ui?returnTo=${encodeURIComponent(returnTo)}`,
    assign: url => navigations.push(url),
  } } });
  vm.runInContext(body.match(/<script>([\s\S]*)<\/script>/)[1], context);
  await new Promise(resolve => setImmediate(resolve));
  const all = element => [element, ...element.children.flatMap(all)];
  return { fields, ids, calls, navigations, returnTo, calibrationCalls, savedSettings,
    buttons: text => all(ids.settings).filter(element => element.tag === 'button' && element.textContent === text),
    scale: weight => { time += 300; socket.onmessage({ data: JSON.stringify({ weight }) }); },
    change: () => ids.settings.handlers.change(), submit: () => ids.settings.handlers.submit({ preventDefault() {} }) };
}

test('standalone form exposes only configured starting pitchers and a working return link', async () => {
  const p = await page();
  assert.deepEqual(p.fields.defaultPitcher.children.map(option => option.value), ['medium']);
  assert.equal(p.ids['automatic-fields'].hidden, true);
  assert.equal(p.fields.singleDrinkGrams.required, false);
  assert.equal(p.ids['return-settings'].href, p.returnTo);
  assert.equal(p.fields.referenceSteamTemperature, undefined);
  assert.equal(p.fields.maxSeconds, undefined);
  assert.equal(p.fields.referenceFlow.min, '0.4');
  assert.equal(p.fields.referenceFlow.max, '2.5');
  await p.submit();
  assert.deepEqual(p.calls, ['status', 'validate', 'settings']);
  assert.deepEqual(p.navigations, [p.returnTo]);
});

test('enabling Auto reveals required fields and incomplete Auto cannot save or navigate', async () => {
  const p = await page();
  p.fields.autoDetect.checked = true;
  await p.change();
  assert.equal(p.ids['automatic-fields'].hidden, false);
  assert.equal(p.fields.singleDrinkGrams.required, true);
  assert.equal(p.fields.singleDrinkPitcher.required, true);
  assert.ok(!p.fields.defaultPitcher.children.some(option => option.value === 'auto'));
  await p.submit();
  assert.deepEqual(p.calls, ['status']);
  assert.deepEqual(p.navigations, []);
  assert.match(p.ids.status.textContent, /all three pitcher weights/);
});

test('failed persistence leaves the form open with an error', async () => {
  const p = await page(partial, true);
  await p.submit();
  assert.deepEqual(p.navigations, []);
  assert.equal(p.ids.status.textContent, 'Save failed');
  assert.equal(p.ids.save.disabled, false);
});


test('tare waits for zero before capturing a stable empty pitcher weight', async () => {
  const p = await page();
  const tare = p.buttons('Tare empty scale')[0];
  const set = p.buttons('Set from scale')[0];
  await tare.handlers.click();
  for (let i = 0; i < 10; i++) p.scale(150);
  await set.handlers.click();
  assert.equal(p.fields.smallPitcherGrams.value, '');
  assert.match(set.parent.children.at(-1).textContent, /stable zero/);
  assert.notEqual(set.parent.tag, 'label');
  for (let i = 0; i < 12; i++) p.scale(0);
  for (let i = 0; i < 12; i++) p.scale(155.5);
  await set.handlers.click();
  assert.equal(p.fields.smallPitcherGrams.value, '155.5');
  assert.ok(p.fields.defaultPitcher.children.some(option => option.value === 'small'));
  assert.ok(p.calls.includes('tare'));
});

test('calibration offers its own empty-scale tare and captures milk after subtracting the chosen pitcher', async () => {
  const p = await page();
  assert.equal(p.buttons('Tare empty scale').length, 2);
  await p.buttons('Tare empty scale')[1].handlers.click();
  for (let i = 0; i < 12; i++) p.scale(0);
  for (let i = 0; i < 12; i++) p.scale(380);
  await p.buttons('Capture pitcher + milk')[0].handlers.click();
  assert.equal(p.buttons('Prepare calibration')[0].disabled, false);
  assert.equal(p.buttons('Start steam')[0].disabled, true);
  assert.equal(p.calls.filter(call => call === 'calibration').length, 0);
});


test('guided form starts and stops, fills measured values, and saves back to settings', async () => {
  const p = await page(partial, false, true);
  await p.buttons('Tare empty scale')[1].handlers.click();
  for (let i = 0; i < 12; i++) p.scale(0);
  for (let i = 0; i < 12; i++) p.scale(380);
  await p.buttons('Capture pitcher + milk')[0].handlers.click();
  await p.buttons('Prepare calibration')[0].handlers.click();
  assert.equal(p.calibrationCalls[0].milkGrams, 160);
  assert.equal(p.calibrationCalls[0].pitcher, 'medium');
  assert.equal(p.calibrationCalls[0].flow, 1.5);
  assert.equal(p.ids.save.disabled, true);
  assert.equal(p.fields.referenceFlow.disabled, true);
  assert.equal(p.buttons('Start steam')[0].disabled, false);
  await p.buttons('Start steam')[0].handlers.click();
  assert.equal(p.buttons('Start steam')[0].disabled, true);
  assert.equal(p.buttons('Stop steam')[0].disabled, false);
  await p.buttons('Stop steam')[0].handlers.click();
  assert.equal(p.ids.save.disabled, false);
  assert.equal(p.fields.referenceSeconds.value, '25');
  assert.equal(p.fields.referenceMilkGrams.value, '160');
  assert.equal(p.buttons('Prepare calibration')[0].disabled, true);
  await p.submit();
  assert.deepEqual(p.navigations, [p.returnTo]);
});

test('Return to settings cancels an active guided run before navigating', async () => {
  const p = await page(partial, false, true);
  await p.buttons('Tare empty scale')[1].handlers.click();
  for (let i = 0; i < 12; i++) p.scale(0);
  for (let i = 0; i < 12; i++) p.scale(380);
  await p.buttons('Capture pitcher + milk')[0].handlers.click();
  await p.buttons('Prepare calibration')[0].handlers.click();
  let prevented = false;
  await p.ids['return-settings'].handlers.click({ preventDefault() { prevented = true; } });
  assert.equal(prevented, true);
  assert.equal(p.calibrationCalls.at(-1).action, 'cancel');
  assert.deepEqual(p.navigations, [p.returnTo]);
  assert.equal(p.calls.includes('settings'), false);
});


test('compact tabs group settings and reveal invalid calibration fields on save', async () => {
  const p = await page({ ...partial, referenceSeconds: 0 });
  assert.equal(p.ids['panel-general'].hidden, false);
  assert.equal(p.ids['panel-pitchers'].hidden, true);
  await p.ids['tab-pitchers'].handlers.click();
  assert.equal(p.ids['panel-pitchers'].hidden, false);
  assert.equal(p.fields.autoDetect.closest('fieldset'), p.fields.singleDrinkGrams.closest('fieldset'));
  assert.match(p.ids['configuration-summary'].textContent, /Configured: M/);
  assert.match(p.ids['configuration-summary'].textContent, /setup required/);
  await p.submit();
  assert.equal(p.ids['panel-calibration'].hidden, false);
  assert.equal(p.fields.referenceSeconds.closest('details').open, true);
  assert.equal(p.fields.referenceSeconds.focused, true);
});

test('both Flow inputs edit one saved value and clear the previous calibration time', async () => {
  const p = await page();
  const mirror = p.ids['calibration-flow'];
  mirror.value = '0.4'; await mirror.handlers.input();
  assert.equal(p.fields.referenceFlow.value, '0.4');
  assert.equal(p.fields.referenceSeconds.value, '');
  p.fields.referenceFlow.value = '0.8';
  await p.ids.settings.handlers.input({ target: p.fields.referenceFlow });
  assert.equal(mirror.value, '0.8');
  assert.match(p.ids['configuration-summary'].textContent, /setup required/);
});

test('a blocked milk capture explains the missing tare beside its own button', async () => {
  const p = await page();
  const capture = p.buttons('Capture pitcher + milk')[0];
  await capture.handlers.click();
  const message = capture.parent.parent.children.at(-1);
  assert.match(message.textContent, /stable zero/);
  assert.equal(p.buttons('Prepare calibration')[0].disabled, true);
});

test('multiple-flow manual wizard requires all readings and saves the full draft once', async () => {
  const p = await page();
  await p.ids['flow-mode-multiple'].handlers.click();
  assert.equal(p.fields.calibrationMode.value, 'multiple');
  assert.deepEqual(JSON.parse(p.fields.flowReadings.value).map(r => r.flow), [0.4, 1.5, 2.5]);
  await p.submit();
  assert.equal(p.savedSettings.length, 0);
  assert.equal(p.ids['panel-calibration'].hidden, false);
  for (const seconds of [40, 20, 12]) {
    p.fields.referenceMilkGrams.value = '200'; p.fields.referenceSeconds.value = seconds;
    await p.ids['flow-use-reading'].handlers.click();
  }
  assert.equal(p.ids['flow-review'].hidden, false);
  await p.submit();
  assert.equal(p.savedSettings.length, 1);
  assert.deepEqual(JSON.parse(p.savedSettings[0].flowReadings), [
    { flow: 0.4, milkGrams: 200, seconds: 40 }, { flow: 1.5, milkGrams: 200, seconds: 20 }, { flow: 2.5, milkGrams: 200, seconds: 12 },
  ]);
});

test('guided multiple readings prepare the machine at each planned flow and require fresh captures', async () => {
  const p = await page(partial, false, true);
  await p.ids['flow-mode-multiple'].handlers.click();
  await p.ids['flow-method-guided'].handlers.click();
  for (const expected of [0.4, 1.5, 2.5]) {
    assert.equal(p.buttons('Prepare calibration')[0].disabled, true);
    await p.buttons('Tare empty scale')[1].handlers.click();
    for (let i = 0; i < 12; i++) p.scale(0);
    for (let i = 0; i < 12; i++) p.scale(380);
    await p.buttons('Capture pitcher + milk')[0].handlers.click();
    await p.buttons('Prepare calibration')[0].handlers.click();
    assert.equal(p.calibrationCalls.at(-1).flow, expected);
    assert.equal(p.ids['flow-reading-count'].disabled, true);
    assert.equal(p.ids['flow-mode-single'].disabled, true);
    await p.buttons('Start steam')[0].handlers.click();
    await p.buttons('Stop steam')[0].handlers.click();
    await p.ids['flow-use-reading'].handlers.click();
  }
  assert.equal(p.fields.referenceFlow.value, '1.5');
  await p.submit();
  assert.deepEqual(JSON.parse(p.savedSettings[0].flowReadings).map(r => r.flow), [0.4, 1.5, 2.5]);
});

test('changing default flow preserves multiple measurements and editing a reading requires use again', async () => {
  const readings = [{ flow: 0.4, milkGrams: 200, seconds: 40 }, { flow: 2.5, milkGrams: 200, seconds: 10 }];
  const p = await page({ ...partial, calibrationMode: 'multiple', flowReadings: JSON.stringify(readings) });
  assert.equal(p.fields.referenceSeconds.value, '40');
  p.ids['calibration-flow'].value = '1.0'; await p.ids['calibration-flow'].handlers.input();
  assert.equal(p.fields.referenceSeconds.value, '40');
  assert.deepEqual(JSON.parse(p.fields.flowReadings.value), readings);
  p.fields.referenceSeconds.value = '45';
  await p.ids.settings.handlers.input({ target: p.fields.referenceSeconds });
  await p.submit();
  assert.equal(p.savedSettings.length, 0);
  await p.ids['flow-use-reading'].handlers.click();
  await p.submit();
  assert.equal(p.savedSettings[0].referenceFlow, 1);
  assert.equal(JSON.parse(p.savedSettings[0].flowReadings)[0].seconds, 45);
});

test('invalid planned range cannot reuse old points or save until corrected', async () => {
  const p = await page(); await p.ids['flow-mode-multiple'].handlers.click();
  p.ids['flow-minimum'].value = '0.3'; await p.ids['flow-minimum'].handlers.change();
  assert.equal(p.ids['flow-use-reading'].disabled, true);
  for (let i = 0; i < 3; i++) {
    p.fields.referenceMilkGrams.value = '200'; p.fields.referenceSeconds.value = '30';
    await p.ids['flow-use-reading'].handlers.click();
  }
  await p.submit(); assert.equal(p.savedSettings.length, 0);
  p.ids['flow-minimum'].value = '0.4'; await p.ids['flow-minimum'].handlers.change();
  assert.equal(p.ids['flow-use-reading'].disabled, false);
  assert.equal(p.fields.referenceSeconds.value, '');
});

test('configured pitcher badges follow valid choices and keep calibration readiness separate', async () => {
  const p = await page({ ...partial, referenceSeconds: 0 });
  const badges = () => p.ids['configuration-summary'].children.filter(child => child.className === 'configured-pitcher').map(child => child.textContent);
  assert.deepEqual(badges(), ['M']);
  assert.match(p.ids['configuration-summary'].textContent, /setup required/);
  p.fields.smallPitcherGrams.value = '150';
  p.fields.largePitcherGrams.value = '300';
  p.fields.autoDetect.checked = true;
  await p.change();
  assert.deepEqual(badges(), ['S', 'M', 'L']);
  p.fields.singleDrinkGrams.value = '160';
  p.fields.singleDrinkPitcher.value = 'small';
  await p.change();
  assert.deepEqual(badges(), ['S', 'M', 'L', 'Auto']);
  p.fields.autoDetect.checked = false;
  p.fields.smallPitcherGrams.value = '';
  await p.change();
  assert.deepEqual(badges(), ['M', 'L']);
});
