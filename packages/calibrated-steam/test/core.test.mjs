import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calculate, validateSettings } from '../src/core.mjs';

export const settings = {
  smallJugGrams: 150, mediumJugGrams: 220, largeJugGrams: 300,
  singleDrinkGrams: 160, singleDrinkJug: 'small', weightMode: 'gross',
  referenceMilkGrams: 150, referenceSeconds: 25,
  referenceFlow: 1.5, referenceSteamTemperature: 150, maxSeconds: 120,
};
export function request(weightGrams, extra = {}) {
  return {
    samples: [800, 400, 0].map(ageMs => ({ weightGrams, ageMs })),
    jug: 'auto', steamFlow: 1.5, steamTemperature: 150,
    stopAtTemperature: 0, machineState: 'idle', ...extra,
  };
}
const throwsCode = (run, code) => assert.throws(run, e => e.code === code);

test('calibrated ratio subtracts jug weight and rounds to whole seconds', () => {
  const result = calculate(settings, request(330));
  assert.equal(result.jug, 'small');
  assert.equal(result.milkGrams, 180);
  assert.equal(result.durationSeconds, 30);
  assert.deepEqual(result.workflowPatch, { steamSettings: { duration: 30 } });
});

test('Damian small-single heuristic uses strict > at both boundaries', () => {
  for (const [weight, jug] of [[422, 'small'], [422.1, 'medium'], [652, 'medium'], [652.1, 'large']]) {
    assert.equal(calculate(settings, request(weight)).jug, jug);
  }
});

test('Damian medium-single heuristic uses the 0.7 and 1.7 boundaries', () => {
  for (const [weight, jug] of [[262, 'small'], [262.1, 'medium'], [492, 'medium'], [492.1, 'large']]) {
    assert.equal(calculate({ ...settings, singleDrinkJug: 'medium' }, request(weight)).jug, jug);
  }
});

test('manual jug override corrects an inference', () => {
  const result = calculate(settings, request(400, { jug: 'medium' }));
  assert.equal(result.milkGrams, 180);
  assert.equal(result.jugSource, 'manual');
});

test('tared mode never subtracts a jug or pretends to infer its size', () => {
  const result = calculate({ ...settings, weightMode: 'tared' }, request(180));
  assert.equal(result.durationSeconds, 30);
  assert.equal(result.jug, null);
  assert.equal(result.jugSource, 'tared');
  assert.equal(calculate({ ...settings, weightMode: 'tared' }, request(180, { jug: 'large' })).milkGrams, 180);
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
    { referenceFlow: Infinity }, { smallJugGrams: -1 }, { maxSeconds: 256 },
    { maxSeconds: 1.5 }, { weightMode: 'guess' }, { singleDrinkJug: 'large' },
    { referenceSeconds: '25' }, { referenceSteamTemperature: 80 },
  ]) {
    assert.ok(validateSettings({ ...settings, ...invalid }).length);
    throwsCode(() => calculate({ ...settings, ...invalid }, request(330)), 'configuration_required');
  }
});

test('refuses nonpositive milk, excessive milk and duration beyond the configured limit', () => {
  throwsCode(() => calculate(settings, request(150, { jug: 'small' })), 'invalid_milk_weight');
  throwsCode(() => calculate(settings, request(3000, { jug: 'small' })), 'invalid_milk_weight');
  throwsCode(() => calculate({ ...settings, maxSeconds: 20 }, request(330)), 'duration_out_of_range');
});

test('flow, heater temperature and probe stop must agree with timed calibration', () => {
  throwsCode(() => calculate(settings, request(330, { steamFlow: 1 })), 'calibration_mismatch');
  throwsCode(() => calculate(settings, request(330, { steamTemperature: 140 })), 'calibration_mismatch');
  throwsCode(() => calculate(settings, request(330, { stopAtTemperature: 60 })), 'probe_stop_active');
  throwsCode(() => calculate(settings, request(330, { steamFlow: null })), 'calibration_mismatch');
});

test('only an idle machine can accept a calculated timer', () => {
  for (const machineState of ['steam', 'espresso', 'sleeping', 'disconnected', null]) {
    throwsCode(() => calculate(settings, request(330, { machineState })), 'machine_not_idle');
  }
});

test('bad request shapes and unknown jug values fail without producing a duration', () => {
  throwsCode(() => calculate(settings, null), 'invalid_request');
  throwsCode(() => calculate(settings, request(330, { jug: 'huge' })), 'invalid_request');
});
