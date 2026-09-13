import { test } from 'node:test';
import assert from 'node:assert/strict';
import { settingsReturnUrl } from '../src/settings-navigation.mjs';

const page = 'http://localhost:8080/api/v1/plugins/calibrated-steam.reaplugin/ui';
test('explicit skin return address preserves route and port', () => {
  const target = 'http://localhost:43210/?page=settings';
  assert.equal(settingsReturnUrl(`${page}?returnTo=${encodeURIComponent(target)}`), target);
});
test('return address can target another local skin without Streamline knowledge', () => {
  const target = 'http://127.0.0.1:3000/settings/extensions';
  assert.equal(settingsReturnUrl(`${page}?returnTo=${encodeURIComponent(target)}`), target);
});
test('direct opens have a Decaid settings fallback and unsafe URLs are refused', () => {
  const fallback = 'http://localhost:8080/api/v1/plugins/settings.reaplugin/ui';
  for (const target of ['', 'javascript:alert(1)', 'https://evil.example/', 'http://user:pass@localhost:3000/', page]) {
    assert.equal(settingsReturnUrl(`${page}?returnTo=${encodeURIComponent(target)}`), fallback);
  }
});
