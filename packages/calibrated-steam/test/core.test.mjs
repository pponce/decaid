import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calculate, validateSettings, availablePitchers } from '../src/core.mjs';

export const settings = {
  smallPitcherGrams: 150, mediumPitcherGrams: 220, largePitcherGrams: 300,
  autoDetect: true, singleDrinkGrams: 160, singleDrinkPitcher: 'small', weightMode: 'gross',
  referenceMilkGrams: 150, referenceSeconds: 25,
  referenceFlow: 1.5,
};
export function request(weightGrams, extra = {}) {
  return {
    samples: [800, 400, 0].map(ageMs => ({ weightGrams, ageMs })),
    pitcher: 'auto', steamFlow: 1.5, steamTemperature: 150,
    stopAtTemperature: 0, machineState: 'idle', ...extra,
  };
}
const throwsCode = (run, code) => assert.throws(run, e => e.code === code);

test('calibrated ratio subtracts pitcher weight and rounds to whole seconds', () => {
  const result = calculate(settings, request(330));
  assert.equal(result.pitcher, 'small');
  assert.equal(result.milkGrams, 180);
  assert.equal(result.durationSeconds, 30);
  assert.deepEqual(result.workflowPatch, { steamSettings: { duration: 30, flow: 1.5 } });
});

test('Damian small-single heuristic uses strict > at both boundaries', () => {
  for (const [weight, pitcher] of [[422, 'small'], [422.1, 'medium'], [652, 'medium'], [652.1, 'large']]) {
    assert.equal(calculate(settings, request(weight)).pitcher, pitcher);
  }
});

test('Damian medium-single heuristic uses the 0.7 and 1.7 boundaries', () => {
  for (const [weight, pitcher] of [[262, 'small'], [262.1, 'medium'], [492, 'medium'], [492.1, 'large']]) {
    assert.equal(calculate({ ...settings, singleDrinkPitcher: 'medium' }, request(weight)).pitcher, pitcher);
  }
});

test('manual pitcher override corrects an inference', () => {
  const result = calculate(settings, request(400, { pitcher: 'medium' }));
  assert.equal(result.milkGrams, 180);
  assert.equal(result.pitcherSource, 'manual');
});

test('tared mode never subtracts a pitcher or pretends to infer its size', () => {
  const result = calculate({ ...settings, autoDetect: false, weightMode: 'tared' }, request(180, { pitcher: 'small' }));
  assert.equal(result.durationSeconds, 30);
  assert.equal(result.pitcher, 'small');
  assert.equal(result.pitcherSource, 'tared');
  assert.equal(calculate({ ...settings, autoDetect: false, weightMode: 'tared' }, request(180, { pitcher: 'large' })).milkGrams, 180);
});

test('stable readings use the median instead of a single outlying final digit', () => {
  const input = request(330);
  input.samples[2].weightGrams = 331;
  assert.equal(calculate(settings, input).milkGrams, 180);
});

test('rejects stale, too few, unordered, invalid and unstable readings', () => {
  for (const samples of [[], [{ weightGrams: 330, ageMs: 0 }],
    [2500, 2000, 1600].map(ageMs => ({ weightGrams: 330, ageMs })),
    [0, 400, 800].map(ageMs => ({ weightGrams: 330, ageMs })),
    [500, 250, 0].map(ageMs => ({ weightGrams: NaN, ageMs })),
    [800, 400, 0].map((ageMs, i) => ({ weightGrams: 330 + i * 4, ageMs })),
    [100, 50, 0].map(ageMs => ({ weightGrams: 330, ageMs })),
    [800, 400, -1].map(ageMs => ({ weightGrams: 330, ageMs })),
  ]) throwsCode(() => calculate(settings, request(330, { samples })), 'scale_not_ready');
});

test('rejects invalid configuration without silently substituting a calibration', () => {
  for (const invalid of [{ referenceMilkGrams: 0 }, { referenceSeconds: 0 },
    { referenceFlow: Infinity }, { smallPitcherGrams: -1 },
    { weightMode: 'guess' }, { singleDrinkPitcher: 'large' },
    { referenceSeconds: '25' },
  ]) {
    assert.ok(validateSettings({ ...settings, ...invalid }).length);
    throwsCode(() => calculate({ ...settings, ...invalid }, request(330)), 'configuration_required');
  }
});

test('refuses nonpositive milk, excessive milk and duration beyond the configured limit', () => {
  throwsCode(() => calculate(settings, request(150, { pitcher: 'small' })), 'invalid_milk_weight');
  throwsCode(() => calculate(settings, request(3000, { pitcher: 'small' })), 'invalid_milk_weight');
  throwsCode(() => calculate({ ...settings, referenceSeconds: 255 }, request(330)), 'duration_out_of_range');
});

test('heater temperatures do not change the calculated time or appear in the patch', () => {
  for (const steamTemperature of [undefined, 0, 135, 150, 165]) {
    const result = calculate(settings, request(330, { steamTemperature }));
    assert.equal(result.durationSeconds, 30);
    assert.deepEqual(result.workflowPatch.steamSettings, { duration: 30, flow: 1.5 });
  }
  throwsCode(() => calculate(settings, request(330, { stopAtTemperature: 60 })), 'probe_stop_active');
});

test('no configurable maximum or stored calibration heater is needed or used', () => {
  const result = calculate({ ...settings, referenceSeconds: 120, maxSeconds: 20, referenceSteamTemperature: 0 }, request(330));
  assert.equal(result.durationSeconds, 144);
  assert.equal(calculate({ ...settings, referenceSeconds: 255 }, request(300)).durationSeconds, 255);
});

test('only an idle machine can accept a calculated timer', () => {
  for (const machineState of ['steam', 'espresso', 'sleeping', 'disconnected', null]) {
    throwsCode(() => calculate(settings, request(330, { machineState })), 'machine_not_idle');
  }
});

test('bad request shapes and unknown pitcher values fail without producing a duration', () => {
  throwsCode(() => calculate(settings, null), 'invalid_request');
  throwsCode(() => calculate(settings, request(330, { pitcher: 'huge' })), 'invalid_request');
});


test('one configured pitcher is sufficient without automatic detection', () => {
  const partial = { ...settings, autoDetect: false, defaultPitcher: 'medium', smallPitcherGrams: 0, largePitcherGrams: 0, singleDrinkGrams: 0, singleDrinkPitcher: '' };
  assert.deepEqual(validateSettings(partial), []);
  assert.deepEqual(availablePitchers(partial), ['medium']);
  assert.equal(calculate(partial, request(400, { pitcher: 'medium' })).milkGrams, 180);
  throwsCode(() => calculate(partial, request(400, { pitcher: 'small' })), 'pitcher_not_configured');
  throwsCode(() => calculate(partial, request(400)), 'pitcher_not_configured');
});

test('saving requires a pitcher and a configured starting choice', () => {
  assert.ok(validateSettings({ ...settings, autoDetect: false, smallPitcherGrams: 0, mediumPitcherGrams: 0, largePitcherGrams: 0 }).some(e => e.field === 'pitchers'));
  assert.ok(validateSettings({ ...settings, autoDetect: false, defaultPitcher: 'large', largePitcherGrams: 0 }).some(e => e.field === 'defaultPitcher'));
  assert.ok(validateSettings({ ...settings, autoDetect: false, defaultPitcher: 'auto' }).some(e => e.field === 'defaultPitcher'));
});

test('automatic detection is explicit and requires its inputs and all heuristic weights', () => {
  assert.deepEqual(availablePitchers(settings), ['small', 'medium', 'large', 'auto']);
  for (const invalid of [{ autoDetect: false }, { singleDrinkGrams: 0 }, { singleDrinkPitcher: '' }, { mediumPitcherGrams: 0 }, { weightMode: 'tared' }]) {
    assert.ok(!availablePitchers({ ...settings, ...invalid }).includes('auto'));
    if (invalid.autoDetect !== false) assert.ok(validateSettings({ ...settings, ...invalid }).length);
  }
});


test('calibration flow accepts 0.4 through 2.5 ml/s, including both endpoints', () => {
  for (const referenceFlow of [0.4, 1.5, 2.5]) {
    assert.deepEqual(validateSettings({ ...settings, referenceFlow }), []);
    assert.equal(calculate({ ...settings, referenceFlow }, request(330)).workflowPatch.steamSettings.flow, referenceFlow);
  }
  for (const referenceFlow of [0, 0.3, 2.6]) {
    assert.ok(validateSettings({ ...settings, referenceFlow }).some(error => error.field === 'referenceFlow'));
  }
});

test('low milk errors name the manually selected or inferred pitcher concisely', () => {
  const settings = { autoDetect: true, smallPitcherGrams: 150, mediumPitcherGrams: 400, largePitcherGrams: 500,
    singleDrinkGrams: 100, singleDrinkPitcher: 'small', weightMode: 'gross', defaultPitcher: 'small',
    referenceMilkGrams: 150, referenceSeconds: 25, referenceFlow: 0.4 };
  for (const pitcher of ['medium', 'auto']) {
    assert.throws(() => calculate(settings, { pitcher, machineState: 'idle', stopAtTemperature: 0,
      samples: [800, 400, 0].map(ageMs => ({ weightGrams: 405, ageMs })) }),
      error => error.code === 'invalid_milk_weight' && error.message === 'Milk < 10 g · Medium pitcher');
  }
});
