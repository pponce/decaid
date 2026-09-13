import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../../../assets/plugins/calibrated-steam.reaplugin/plugin.js', import.meta.url), 'utf8');
const partial = { autoDetect: false, smallJugGrams: 0, mediumJugGrams: 220, largeJugGrams: 0,
  defaultJug: 'medium', referenceMilkGrams: 150, referenceSeconds: 25,
  referenceFlow: 1.5 };

async function page(settings = partial, failSave = false) {
  const runtime = vm.createContext({});
  vm.runInContext(source, runtime);
  const plugin = runtime.createPlugin();
  plugin.onLoad(settings);
  const fields = {};
  class Element {
    constructor(tag) { this.tag = tag; this.children = []; this.handlers = {}; this.value = ''; }
    set value(value) { this._value = String(value); }
    get value() { return this._value; }
    set name(value) { this.fieldName = value; fields[value] = this; }
    append(...children) { for (const child of children) { this.children.push(child); child.parent = this; if (this.tag === 'select' && !this.value) this.value = child.value; } }
    replaceChildren() { this.children = []; this.value = ''; }
    closest(tag) { return this.tag === tag ? this : this.parent?.closest(tag); }
    addEventListener(event, handler) { this.handlers[event] = handler; }
  }
  const ids = Object.fromEntries(['settings', 'status', 'save', 'return-settings'].map(id => [id, new Element(id === 'settings' ? 'form' : id)]));
  ids.settings.elements = { namedItem: key => fields[key] };
  const navigations = [];
  const calls = [];
  const returnTo = 'http://localhost:43210/?page=settings';
  const document = { referrer: '', getElementById: id => ids[id], createElement: tag => new Element(tag) };
  const fetch = async (url, options = {}) => {
    const endpoint = url.split('/').at(-1);
    calls.push(endpoint);
    if (endpoint === 'settings') {
      if (failSave) throw new Error('Save failed');
      return { ok: true, json: async () => ({}) };
    }
    const response = plugin.__httpRequestHandler({ endpoint, method: options.method ?? 'GET', body: options.body ? JSON.parse(options.body) : null });
    return { ok: response.status === 200, json: async () => JSON.parse(response.body) };
  };
  const body = plugin.__httpRequestHandler({ endpoint: 'ui', method: 'GET' }).body;
  const context = vm.createContext({ document, fetch, URL, window: { location: {
    href: `http://localhost:8080/api/v1/plugins/calibrated-steam.reaplugin/ui?returnTo=${encodeURIComponent(returnTo)}`,
    assign: url => navigations.push(url),
  } } });
  vm.runInContext(body.match(/<script>([\s\S]*)<\/script>/)[1], context);
  await new Promise(resolve => setImmediate(resolve));
  return { fields, ids, calls, navigations, returnTo, change: () => ids.settings.handlers.change(), submit: () => ids.settings.handlers.submit({ preventDefault() {} }) };
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
  p.change();
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
