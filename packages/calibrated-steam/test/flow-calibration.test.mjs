import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calculate, validateSettings } from '../src/core.mjs';
import { proposedFlows, flowCalibration } from '../src/flow-calibration.mjs';

const base = { smallPitcherGrams: 150, mediumPitcherGrams: 0, largePitcherGrams: 0, autoDetect: false,
  weightMode: 'gross', defaultPitcher: 'small', referenceFlow: 1.5, referenceMilkGrams: 200, referenceSeconds: 40 };
const input = flow => ({ pitcher: 'small', flow, machineState: 'idle', stopAtTemperature: 0,
  samples: [800, 400, 0].map(ageMs => ({ ageMs, weightGrams: 350 })) });
const readings = [{ flow: 0.4, milkGrams: 200, seconds: 40 }, { flow: 2.5, milkGrams: 100, seconds: 5 }];
const multi = list => ({ ...base, calibrationMode: 'multiple', flowReadings: JSON.stringify(list) });

test('single calibration preserves old settings and rejects a different requested flow', () => {
  assert.equal(calculate(base, input(undefined)).durationSeconds, 40);
  assert.equal(flowCalibration(base).adjustable, false);
  assert.throws(() => calculate(base, input(0.4)), e => e.code === 'flow_out_of_range');
});
test('two readings interpolate seconds per gram, honor endpoints, and never extrapolate', () => {
  assert.equal(calculate(multi(readings), input(0.4)).durationSeconds, 40);
  assert.equal(calculate(multi(readings), input(2.5)).durationSeconds, 10);
  assert.equal(calculate(multi(readings), input(1.45)).durationSeconds, 25);
  assert.equal(calculate(multi(readings), input(1.45)).workflowPatch.steamSettings.flow, 1.45);
  for (const flow of [0.3, 2.6, '1.5', NaN]) assert.throws(() => calculate(multi(readings), input(flow)), e => e.code === 'flow_out_of_range');
});
test('three readings interpolate only the adjacent segment, including exact middle measurements', () => {
  const settings = multi([readings[0], { flow: 1.4, milkGrams: 200, seconds: 18 }, readings[1]]);
  assert.equal(calculate(settings, input(1.4)).durationSeconds, 18);
  assert.equal(calculate(settings, input(0.9)).durationSeconds, 29);
  assert.equal(calculate(settings, input(1.95)).durationSeconds, 14);
});
test('multiple calibration validates all readings, ordering, separation, and default range', () => {
  for (const list of [[], [readings[0]], [readings[1], readings[0]], [readings[0], readings[0]],
    [readings[0], { ...readings[1], milkGrams: 0 }], [readings[0], null],
    [readings[0], { ...readings[1], flow: 0.41 }], [...readings, ...readings, ...readings]]) {
    assert.ok(validateSettings(multi(list)).some(e => e.field === 'flowReadings'));
    assert.equal(flowCalibration(multi(list)), null);
  }
  assert.ok(validateSettings({ ...multi(readings), flowReadings: '{bad' }).length);
  assert.ok(validateSettings({ ...multi(readings), referenceFlow: 0.3 }).length);
  assert.equal(validateSettings({ ...multi(readings), referenceFlow: 0.9, referenceSeconds: 0 }).length, 0);
});
test('suggested flows include endpoints, are evenly spaced, and reject duplicate rounded values', () => {
  assert.deepEqual(proposedFlows(0.4, 2.5, 2), [0.4, 2.5]);
  assert.deepEqual(proposedFlows(0.4, 2.5, 3), [0.4, 1.5, 2.5]);
  assert.deepEqual(proposedFlows(0.4, 2.5, 4), [0.4, 1.1, 1.8, 2.5]);
  assert.throws(() => proposedFlows(0.4, 0.5, 4));
});
