import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../../../assets/plugins/calibrated-steam.reaplugin/plugin.js', import.meta.url), 'utf8');
const partial = { autoDetect: false, smallJugGrams: 0, mediumJugGrams: 220, largeJugGrams: 0,
  defaultJug: 'medium', referenceMilkGrams: 150, referenceSeconds: 25,
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
    append(...children) { for (const child of children) { this.children.push(child); child.parent = this; if (this.tag === 'select' && !this.value) this.value = child.value; } }
    replaceChildren() { this.children = []; this.value = ''; }
    closest(tag) { return this.tag === tag ? this : this.parent?.closest(tag); }
    setAttribute(key, value) { this[key] = value; }
    insertBefore(child, before) { this.children.splice(this.children.indexOf(before), 0, child); child.parent = this; }
    addEventListener(event, handler) {
      const previous = this.handlers[event];
      this.handlers[event] = async (...args) => { await previous?.(...args); return handler(...args); };
    }
  }
  const ids = Object.fromEntries(['settings', 'status', 'save', 'return-settings'].map(id => [id, new Element(id === 'settings' ? 'form' : id)]));
  ids.settings.elements = { namedItem: key => fields[key] };
  const navigations = [];
  const calls = [];
  const calibrationCalls = [];
  let session = null;
  const returnTo = 'http://localhost:43210/?page=settings';
  const document = { referrer: '', getElementById: id => ids[id], createElement: tag => new Element(tag) };
  const fetch = async (url, options = {}) => {
    const endpoint = url.split('/').at(-1);
    calls.push(endpoint);
    if (endpoint === 'calibration' && guidedRun) {
      const body = JSON.parse(options.body); calibrationCalls.push(body);
      if (body.action === 'begin') session = { active: true, phase: 'armed', token: 'page-test', seconds: 0, result: null };
      if (body.action === 'start') session = { ...session, phase: 'steaming', seconds: 0 };
      if (body.action === 'stop') session = { ...session, active: false, phase: 'complete', seconds: 25, result: { milkGrams: 160, flow: 1.5, seconds: 25 } };
      if (body.action === 'cancel') session = { ...session, active: false, phase: 'failed', message: 'Cancelled.', result: null };
      return { ok: true, text: async () => JSON.stringify(session) };
    }
    if (endpoint === 'tare') return { ok: true, text: async () => '' };
    if (endpoint === 'settings') {
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
  return { fields, ids, calls, navigations, returnTo, calibrationCalls,
    buttons: text => all(ids.settings).filter(element => element.tag === 'button' && element.textContent === text),
    scale: weight => { time += 300; socket.onmessage({ data: JSON.stringify({ weight }) }); },
    change: () => ids.settings.handlers.change(), submit: () => ids.settings.handlers.submit({ preventDefault() {} }) };
}

test('standalone form exposes only configured starting pitchers and a working return link', async () => {
  const p = await page();
  assert.deepEqual(p.fields.defaultJug.children.map(option => option.value), ['medium']);
  assert.equal(p.fields.singleDrinkGrams.closest('fieldset').hidden, true);
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
  assert.equal(p.fields.singleDrinkGrams.closest('fieldset').hidden, false);
  assert.equal(p.fields.singleDrinkGrams.required, true);
  assert.equal(p.fields.singleDrinkJug.required, true);
  assert.ok(!p.fields.defaultJug.children.some(option => option.value === 'auto'));
  await p.submit();
  assert.deepEqual(p.calls, ['status', 'validate']);
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
  assert.equal(p.fields.smallJugGrams.value, '');
  assert.match(p.ids.status.textContent, /stable zero/);
  for (let i = 0; i < 12; i++) p.scale(0);
  for (let i = 0; i < 12; i++) p.scale(155.5);
  await set.handlers.click();
  assert.equal(p.fields.smallJugGrams.value, '155.5');
  assert.ok(p.fields.defaultJug.children.some(option => option.value === 'small'));
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
