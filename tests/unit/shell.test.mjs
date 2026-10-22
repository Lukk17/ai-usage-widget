import { test } from 'node:test';
import assert from 'node:assert/strict';

import { quote, quoteUrl } from '../../package/contents/code/core/shell.mjs';

test('quote wraps a constant in single quotes', () => {
  assert.equal(quote('Accept: application/json'), "'Accept: application/json'");
  assert.equal(quote('%{http_code}'), "'%{http_code}'");
});

test('quote refuses a single quote, a control character or a non ASCII character instead of escaping it', () => {
  for (const value of ["it's", 'a\nb', 'tab\there', 'zaż', '\u0000']) {
    assert.throws(() => quote(value), /cannot be quoted/, JSON.stringify(value));
  }
});

test('quoteUrl only accepts HTTPS URLs without spaces', () => {
  assert.equal(quoteUrl('https://api.minimax.io/v1/token_plan/remains'), "'https://api.minimax.io/v1/token_plan/remains'");
  assert.throws(() => quoteUrl('http://api.minimax.io/'), /HTTPS/);
  assert.throws(() => quoteUrl('https://a b/'), /HTTPS/);
  assert.throws(() => quoteUrl('file:///etc/passwd'), /HTTPS/);
});
