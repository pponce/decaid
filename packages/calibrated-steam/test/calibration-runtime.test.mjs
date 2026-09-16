import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const source = readFileSync(new URL('../../../assets/plugins/calibrated-steam.reaplugin/plugin.js', import.meta.url), 'utf8');

test('generated plugin owns calibration, protects its session, and restores before returning measured values', async () => {
  let now = 10000, timer;
  const original = { duration: 30, flow: 0.8, targetTemperature: 150, stopAtTemperature: 60 };
  let steamSettings = { ...original };
  const requests = [];
  class Clock extends Date { static now() { return now; } }
  const context = vm.createContext({ Date: Clock, setTimeout: callback => { timer = callback; return 1; }, clearTimeout() {},
    fetch: async (url, options) => {
      requests.push({ url, ...options });
      if (options.method === 'PUT' && url.endsWith('/workflow')) steamSettings = JSON.parse(options.body).steamSettings;
      return { ok: true, status: 200, json: async () => ({ steamSettings }) };
    },
  });
  vm.runInContext(source, context);
  const plugin = context.createPlugin(); plugin.onLoad({});
  const call = async (endpoint, body) => {
    const response = await plugin.__httpRequestHandler({ endpoint, method: body ? 'POST' : 'GET', body });
    return { status: response.status, ...JSON.parse(response.body) };
  };
  const frame = (state, substate = 'idle') => plugin.onEvent({ name: 'stateUpdate', payload: { timestamp: new Date(now).toISOString(), state: { state, substate } } });
  frame('idle');
  const prepared = await call('calibration', { action: 'begin', pitcher: 'small', pitcherGrams: 150, milkGrams: 160, flow: 0.4 });
  assert.equal(prepared.status, 200);
  assert.equal(steamSettings.flow, 0.4);
  assert.equal(steamSettings.targetTemperature, 150);
  assert.equal(steamSettings.stopAtTemperature, 0);
  assert.equal((await call('status')).calibrationActive, true);
  assert.equal((await call('calculate', { pitcher: 'small' })).status, 409);
  assert.equal((await call('calibration', { action: 'begin' })).status, 409);
  assert.equal((await call('calibration', { action: 'start', token: 'other-page' })).status, 409);
  await call('calibration', { action: 'start', token: prepared.token });
  assert.ok(requests.some(r => r.url.endsWith('/machine/state/steam')));
  now += 200; frame('steam', 'preparingForShot');
  now += 1000; frame('steam', 'pouring');
  now += 2000; frame('idle');
  await timer();
  const measured = await call('calibration', { action: 'heartbeat', token: prepared.token });
  assert.equal(measured.result.seconds, 2);
  assert.equal(measured.result.milkGrams, 160);
  assert.equal(measured.active, false);
  assert.deepEqual(steamSettings, original);
  assert.equal((await call('status')).calibrationActive, false);
});
