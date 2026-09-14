import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCalibrationSession, captureScaleWeight } from '../src/calibration-session.mjs';

function fixture() {
  let time = 10000;
  let machine = 'idle';
  const original = { duration: 0, flow: 0.8, targetTemperature: 0, stopAtTemperature: 60 };
  const writes = [], commands = [];
  const session = createCalibrationSession({ now: () => time,
    readWorkflow: async () => ({ steamSettings: writes.at(-1) ?? original }),
    writeSteam: async value => writes.push({ ...value }),
    requestState: async value => commands.push(value),
  });
  function frame(state = machine, substate = 'idle') {
    machine = state;
    session.observe({ timestamp: new Date(time).toISOString(), state: { state, substate } });
  }
  frame();
  const begin = () => session.begin({ milkGrams: 160, pitcher: 'small', pitcherGrams: 150, flow: 0.4, heaterTemperature: 145 });
  const advance = (ms, state, substate) => { time += ms; frame(state, substate); };
  return { session, begin, advance, frame, writes, commands, original, time: ms => { time += ms; } };
}

test('stable weight capture rejects stale, unstable and pre-tare samples', () => {
  const samples = [0, 300, 600].map(at => ({ weight: 150, at }));
  assert.equal(captureScaleWeight(samples, 700), 150);
  assert.throws(() => captureScaleWeight(samples, 3000), /fresh/);
  assert.throws(() => captureScaleWeight(samples.slice(2), 700), /stable/);
  assert.throws(() => captureScaleWeight([...samples.slice(0, 2), { weight: 170, at: 600 }], 700), /stable/);
});

test('calibration applies flow, excludes warm-up, follows physical stop and restores Off', async () => {
  const f = fixture();
  await f.begin();
  assert.deepEqual(f.writes[0], { duration: 255, flow: 0.4, targetTemperature: 145, stopAtTemperature: 0 });
  assert.deepEqual(f.commands, []);
  f.advance(500, 'steam', 'preparingForShot');
  assert.equal(f.session.snapshot().phase, 'heating');
  f.advance(2000, 'steam', 'pouring');
  for (let i = 0; i < 20; i++) { f.session.heartbeat(); f.advance(1000, 'steam', 'pouring'); }
  f.advance(200, 'idle');
  await f.session.tick();
  assert.equal(f.session.snapshot().phase, 'complete');
  assert.equal(f.session.snapshot().result.seconds, 20.2);
  assert.equal(f.session.snapshot().result.milkGrams, 160);
  assert.deepEqual(f.writes.at(-1), f.original);
});

test('page start and stop are commands; stopping counter waits for machine confirmation', async () => {
  const f = fixture(); await f.begin(); await f.session.start();
  assert.deepEqual(f.commands, ['steam']);
  assert.equal(f.session.snapshot().seconds, 0);
  f.advance(200, 'steam', 'pouring');
  f.advance(2000, 'steam', 'pouring');
  await f.session.stop();
  assert.deepEqual(f.commands, ['steam', 'idle']);
  assert.equal(f.session.snapshot().active, true);
  f.advance(200, 'idle'); await f.session.tick();
  assert.equal(f.session.snapshot().result.seconds, 2.2);
});

test('cancel and an expired page lease stop the run without saving a calibration', async () => {
  for (const expire of [false, true]) {
    const f = fixture(); await f.begin(); f.advance(200, 'steam', 'pouring');
    if (expire) { f.advance(7000, 'steam', 'pouring'); await f.session.tick(); }
    else await f.session.cancel();
    assert.equal(f.commands.at(-1), 'idle');
    f.advance(100, 'idle'); await f.session.tick();
    assert.equal(f.session.snapshot().result, null);
    assert.equal(f.session.snapshot().active, false);
    assert.deepEqual(f.writes.at(-1), f.original);
  }
});

test('telemetry gaps invalidate the run and prevent guessed durations', async () => {
  const f = fixture(); await f.begin(); f.advance(100, 'steam', 'pouring');
  f.time(4000); f.session.heartbeat(); await f.session.tick();
  assert.equal(f.commands.at(-1), 'idle');
  f.frame('idle'); await f.session.tick();
  assert.equal(f.session.snapshot().phase, 'failed');
  assert.match(f.session.snapshot().message, /telemetry/);
  assert.equal(f.session.snapshot().result, null);
});

test('missing heater setting, busy machine and invalid flow cannot prepare calibration', async () => {
  for (const patch of [{ flow: 0.3 }, { flow: 2.6 }, { heaterTemperature: 0 }]) {
    const f = fixture();
    await assert.rejects(f.session.begin({ milkGrams: 160, pitcher: 'small', pitcherGrams: 150, flow: 0.4, heaterTemperature: 145, ...patch }));
    assert.equal(f.writes.length, 0);
  }
  const f = fixture(); f.advance(100, 'espresso'); await assert.rejects(f.begin(), /idle/);
});

test('restoration failure retains ownership and retries before exposing a result', async () => {
  let fail = true; let now = 10000;
  const s = createCalibrationSession({ now: () => now, readWorkflow: async () => ({ steamSettings: { duration: 30, flow: 1, targetTemperature: 145 } }),
    writeSteam: async value => { if (value.duration === 30 && fail) throw new Error('write failed'); }, requestState: async () => {} });
  const frame = state => s.observe({ timestamp: new Date(now).toISOString(), state: { state, substate: 'pouring' } });
  frame('idle'); await s.begin({ milkGrams: 150, pitcher: 'small', pitcherGrams: 150, flow: 0.4 });
  now += 100; frame('steam'); now += 2000; frame('idle'); await s.tick();
  assert.equal(s.snapshot().active, true); assert.equal(s.snapshot().result, null);
  fail = false; await s.tick();
  assert.equal(s.snapshot().phase, 'complete');
});

test('cancel during a pending start sends stop again after start settles and waits for a new idle frame', async () => {
  let now = 10000, release;
  const commands = [], writes = [];
  const s = createCalibrationSession({ now: () => now,
    readWorkflow: async () => ({ steamSettings: writes.at(-1) ?? { duration: 30, flow: 1, targetTemperature: 145 } }),
    writeSteam: async value => writes.push(value),
    requestState: async state => { commands.push(state); if (state === 'steam') await new Promise(resolve => { release = resolve; }); },
  });
  const frame = state => { now += 100; s.observe({ timestamp: new Date(now).toISOString(), state: { state, substate: 'pouring' } }); };
  frame('idle'); await s.begin({ milkGrams: 150, pitcher: 'small', pitcherGrams: 150, flow: 0.4 });
  const starting = s.start(); await new Promise(resolve => setImmediate(resolve)); await s.cancel();
  assert.equal(writes.length, 1);
  release(); await starting; await s.tick();
  assert.deepEqual(commands, ['steam', 'idle', 'idle']);
  assert.equal(writes.length, 1);
  frame('idle'); await s.tick();
  assert.equal(writes.length, 2); assert.equal(s.snapshot().result, null);
});

test('a preparation write failure restores even if the failed write partly reached the machine', async () => {
  const writes = []; let now = 10000;
  const s = createCalibrationSession({ now: () => now,
    readWorkflow: async () => ({ steamSettings: { duration: 30, flow: 1, targetTemperature: 145 } }),
    writeSteam: async value => { writes.push(value); if (value.duration === 255) throw new Error('partial failure'); },
    requestState: async () => {},
  });
  s.observe({ timestamp: new Date(now).toISOString(), state: { state: 'idle' } });
  await assert.rejects(s.begin({ milkGrams: 150, pitcher: 'small', pitcherGrams: 150, flow: 0.4 }), /partial failure/);
  await s.tick();
  assert.deepEqual(writes.map(w => w.duration), [255, 30]);
  assert.equal(s.snapshot().result, null);
});

test('Start waits for the flow write and refuses a subsequently changed calibration flow', async () => {
  let release;
  let steamSettings = { duration: 30, flow: 1, targetTemperature: 145, stopAtTemperature: 0 };
  const commands = [];
  const session = createCalibrationSession({ now: () => 10000,
    readWorkflow: async () => ({ steamSettings }),
    writeSteam: async value => { await new Promise(resolve => { release = resolve; }); steamSettings = value; },
    requestState: async value => commands.push(value),
  });
  session.observe({ timestamp: new Date(10000).toISOString(), state: { state: 'idle' } });
  const preparing = session.begin({ milkGrams: 200, pitcher: 'small', pitcherGrams: 150, flow: 2.5 });
  await new Promise(resolve => setImmediate(resolve));
  await assert.rejects(session.start(), /Prepare/);
  assert.equal(session.snapshot().phase, 'preparing');
  release(); await preparing;
  assert.equal(steamSettings.flow, 2.5);
  assert.equal(session.snapshot().phase, 'armed');
  steamSettings = { ...steamSettings, flow: 0.4 };
  await assert.rejects(session.start(), /settings changed/);
  assert.equal(commands.includes('steam'), false);
});
