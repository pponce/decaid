import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const asset = new URL('../../../assets/plugins/calibrated-steam.reaplugin/', import.meta.url);
const source = readFileSync(new URL('plugin.js', asset), 'utf8');
const manifest = JSON.parse(readFileSync(new URL('manifest.json', asset), 'utf8'));
const valid = { smallJugGrams: 150, mediumJugGrams: 220, largeJugGrams: 300, singleDrinkGrams: 160,
  singleDrinkJug: 'small', weightMode: 'gross', referenceMilkGrams: 150, referenceSeconds: 25,
  referenceFlow: 1.5, referenceSteamTemperature: 150, maxSeconds: 120 };
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
  assert.deepEqual(manifest.permissions, ['api']);
  assert.equal(instance.id, manifest.id);
  const status = call(instance, 'status');
  assert.equal(status.json.ready, true);
  assert.equal(status.json.apiVersion, 2);
});

test('fresh installs expose configuration requirements, never invented working values', () => {
  const status = call(plugin({}), 'status');
  assert.equal(status.json.ready, false);
  assert.equal(status.json.settings.referenceSeconds, 0);
  assert.ok(status.json.errors.length > 0);
});

test('calculate endpoint returns calibration flow, heater and duration patch and calibration revision', () => {
  const response = call(plugin(), 'calculate', 'POST', {
    samples: [800, 400, 0].map(ageMs => ({ weightGrams: 330, ageMs })),
    jug: 'auto', machineState: 'idle', steamFlow: 1.5, steamTemperature: 150, stopAtTemperature: 0,
  });
  assert.equal(response.status, 200);
  assert.equal(response.json.durationSeconds, 30);
  assert.deepEqual(response.json.workflowPatch, { steamSettings: { duration: 30, flow: 1.5, targetTemperature: 150 } });
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
