import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const asset = new URL('../../../assets/plugins/calibrated-steam.reaplugin/', import.meta.url);
const source = readFileSync(new URL('plugin.js', asset), 'utf8');
const manifest = JSON.parse(readFileSync(new URL('manifest.json', asset), 'utf8'));
const valid = { autoDetect: true, smallJugGrams: 150, mediumJugGrams: 220, largeJugGrams: 300, singleDrinkGrams: 160,
  singleDrinkJug: 'small', weightMode: 'gross', referenceMilkGrams: 150, referenceSeconds: 25,
  referenceFlow: 1.5 };
function plugin(settings = valid) {
  const context = vm.createContext({});
  vm.runInContext(source, context);
  const instance = context.createPlugin({});
  instance.onLoad(settings);
  return instance;
}
function call(instance, endpoint, method = 'GET', body = null) {
  const response = instance.__httpRequestHandler({ endpoint, method, body });
  return { ...response, json: response.headers['content-type'] === 'application/json' ? JSON.parse(response.body) : null };
}

test('built plugin runs without DOM, timers, network or other host capabilities', () => {
  const instance = plugin();
  assert.deepEqual(manifest.permissions, ['api', 'events.machine']);
  assert.equal(instance.id, manifest.id);
  const status = call(instance, 'status');
  assert.equal(status.json.ready, true);
  assert.equal(status.json.apiVersion, 3);
});

test('fresh installs expose configuration requirements, never invented working values', () => {
  const status = call(plugin({}), 'status');
  assert.equal(status.json.ready, false);
  assert.equal(status.json.settings.referenceSeconds, 0);
  assert.ok(status.json.errors.length > 0);
});

test('calculate endpoint returns calibration flow and duration patch and calibration revision', () => {
  const response = call(plugin(), 'calculate', 'POST', {
    samples: [800, 400, 0].map(ageMs => ({ weightGrams: 330, ageMs })),
    jug: 'auto', machineState: 'idle', steamFlow: 1.5, steamTemperature: 150, stopAtTemperature: 0,
  });
  assert.equal(response.status, 200);
  assert.equal(response.json.durationSeconds, 30);
  assert.deepEqual(response.json.workflowPatch, { steamSettings: { duration: 30, flow: 1.5 } });
  assert.equal(JSON.parse(response.json.calibrationRevision).referenceSeconds, 25);
});

test('configuration validation is read-only and reload replaces calculation settings', () => {
  const instance = plugin();
  assert.equal(call(instance, 'validate', 'POST', { ...valid, referenceSeconds: 0 }).status, 422);
  assert.equal(call(instance, 'status').json.settings.referenceSeconds, 25);
  instance.onLoad({ ...valid, referenceSeconds: 30 });
  assert.equal(call(instance, 'status').json.settings.referenceSeconds, 30);
});

test('disabled, wrong-method and unknown-endpoint requests are explicit failures', () => {
  const instance = plugin();
  assert.equal(call(instance, 'calculate', 'GET').status, 405);
  assert.equal(call(instance, 'missing').status, 404);
  assert.equal(call(instance, 'calculate', 'POST', null).status, 422);
  instance.onUnload();
  assert.equal(call(instance, 'calculate', 'POST', {}).status, 503);
});

test('settings UI is self-contained and credits Damian', () => {
  const response = call(plugin(), 'ui');
  assert.equal(response.status, 200);
  assert.match(response.body, /github.com\/Damian-AU\/DSx2/);
  assert.match(response.body, /form="settings"/);
  const script = response.body.match(/<script>([\s\S]*)<\/script>/)[1];
  assert.doesNotThrow(() => new vm.Script(script));
});


test('status advertises only configured pitcher choices and Auto is opt-in', () => {
  const fresh = call(plugin({}), 'status').json;
  assert.deepEqual(fresh.availablePitchers, []);
  assert.equal(fresh.settings.autoDetect, false);
  assert.equal(fresh.settings.singleDrinkGrams, 0);
  const partial = call(plugin({ ...valid, autoDetect: false, smallJugGrams: 0, largeJugGrams: 0, defaultJug: 'medium', singleDrinkGrams: 0 }), 'status').json;
  assert.equal(partial.ready, true);
  assert.deepEqual(partial.availablePitchers, ['medium']);
});


test('fresh and previously unset calibration flow default to 0.4 ml/s', () => {
  for (const values of [{}, { referenceFlow: 0 }]) assert.equal(call(plugin(values), 'status').json.settings.referenceFlow, 0.4);
});


test('removed calibration fields are absent from schema and ignored on upgrade', () => {
  const status = call(plugin({ ...valid, maxSeconds: 20, referenceSteamTemperature: 0 }), 'status').json;
  assert.equal(status.ready, true);
  for (const key of ['maxSeconds', 'referenceSteamTemperature']) {
    assert.equal(Object.hasOwn(status.schema, key), false);
    assert.equal(Object.hasOwn(status.settings, key), false);
  }
});
