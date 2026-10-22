import { test } from 'node:test';
import assert from 'node:assert/strict';

import { ERROR_KIND, REASON, classifyReply, parseRetryAfter, parseJsonBody, failure } from '../../package/contents/code/core/http.mjs';
import { reply } from './support/replies.mjs';

const NOW = Date.UTC(2026, 9, 18, 12, 0, 0);

test('a 2xx reply is not a failure', () => {
  assert.equal(classifyReply(reply(200, '{}'), NOW), null);
  assert.equal(classifyReply(reply(204, ''), NOW), null);
});

test('a timeout and a lost connection both mean cannot connect, with their own reason', () => {
  assert.deepEqual(classifyReply({ kind: 'timeout' }, NOW), failure(ERROR_KIND.CANNOT_CONNECT, REASON.TIMEOUT));
  assert.deepEqual(classifyReply({ kind: 'network' }, NOW), failure(ERROR_KIND.CANNOT_CONNECT, REASON.NO_CONNECTION));
});

test('another curl failure means cannot connect and keeps the curl exit code', () => {
  assert.deepEqual(classifyReply({ kind: 'curl_error', code: 35 }, NOW), failure(ERROR_KIND.CANNOT_CONNECT, REASON.CURL_ERROR, null, { code: 35 }));
});

test('a check that stopped before its answer was complete means cannot connect', () => {
  assert.deepEqual(classifyReply({ kind: 'incomplete' }, NOW), failure(ERROR_KIND.CANNOT_CONNECT, REASON.INCOMPLETE));
});

test('a missing curl or timeout program means cannot connect because a tool is missing', () => {
  assert.deepEqual(classifyReply({ kind: 'tool_missing' }, NOW), failure(ERROR_KIND.CANNOT_CONNECT, REASON.TOOL_MISSING));
});

test('an answer larger than the size limit is an unexpected answer', () => {
  assert.deepEqual(classifyReply({ kind: 'too_large' }, NOW), failure(ERROR_KIND.UNEXPECTED_ANSWER, REASON.ANSWER_TOO_LARGE));
});

test('401 and 403 mean the key was rejected', () => {
  assert.deepEqual(classifyReply(reply(401, ''), NOW), failure(ERROR_KIND.KEY_REJECTED, REASON.HTTP_STATUS, null, { status: 401 }));
  assert.equal(classifyReply(reply(403, ''), NOW).kind, ERROR_KIND.KEY_REJECTED);
});

test('402 means the account cannot use the service right now', () => {
  assert.deepEqual(classifyReply(reply(402, ''), NOW), failure(ERROR_KIND.NOT_AVAILABLE, REASON.PAYMENT_REQUIRED));
});

test('a redirect is never followed and counts as an unexpected answer', () => {
  for (const status of [301, 302, 303, 307, 308]) {
    assert.deepEqual(classifyReply(reply(status, '', { Location: 'https://other.example/' }), NOW), failure(ERROR_KIND.UNEXPECTED_ANSWER, REASON.REDIRECT, null, { status: status }));
  }
});

test('429 is rate limited and carries the Retry-After time', () => {
  const result = classifyReply(reply(429, '', { 'Retry-After': '120' }), NOW);
  assert.equal(result.kind, ERROR_KIND.RATE_LIMITED);
  assert.equal(result.retryAt, NOW + 120000);
});

test('429 without Retry-After is rate limited with no fixed retry time', () => {
  const result = classifyReply(reply(429, ''), NOW);
  assert.equal(result.kind, ERROR_KIND.RATE_LIMITED);
  assert.equal(result.retryAt, null);
});

test('5xx means the service could not answer and keeps the status', () => {
  assert.deepEqual(classifyReply(reply(500, ''), NOW), failure(ERROR_KIND.CANNOT_CONNECT, REASON.SERVICE_ERROR, null, { status: 500 }));
});

test('503 with Retry-After waits as long as the service asks', () => {
  const result = classifyReply(reply(503, '', { 'Retry-After': '900' }), NOW);
  assert.equal(result.kind, ERROR_KIND.CANNOT_CONNECT);
  assert.equal(result.retryAt, NOW + 900000);
});

test('any other status is an unexpected answer', () => {
  assert.deepEqual(classifyReply(reply(404, ''), NOW), failure(ERROR_KIND.UNEXPECTED_ANSWER, REASON.HTTP_STATUS, null, { status: 404 }));
});

test('a provider override wins over the shared mapping', () => {
  const override = (r) => (r.status === 403 ? failure(ERROR_KIND.NOT_AVAILABLE, REASON.TEAM_ORGANIZATION_REQUIRED) : null);
  assert.equal(classifyReply(reply(403, ''), NOW, override).reason, REASON.TEAM_ORGANIZATION_REQUIRED);
  assert.equal(classifyReply(reply(401, ''), NOW, override).kind, ERROR_KIND.KEY_REJECTED);
});

test('a missing or unknown reply shape is an unexpected answer', () => {
  assert.equal(classifyReply(undefined, NOW).kind, ERROR_KIND.UNEXPECTED_ANSWER);
  assert.equal(classifyReply({ kind: 'other' }, NOW).kind, ERROR_KIND.UNEXPECTED_ANSWER);
});

test('parseRetryAfter reads delay seconds', () => {
  assert.equal(parseRetryAfter('30', NOW), NOW + 30000);
  assert.equal(parseRetryAfter(' 0 ', NOW), NOW);
});

test('parseRetryAfter reads an HTTP date', () => {
  assert.equal(parseRetryAfter('Sun, 18 Oct 2026 12:05:00 GMT', NOW), NOW + 300000);
});

test('parseRetryAfter ignores empty, negative and garbage values', () => {
  assert.equal(parseRetryAfter(null, NOW), null);
  assert.equal(parseRetryAfter('', NOW), null);
  assert.equal(parseRetryAfter('-5', NOW), null);
  assert.equal(parseRetryAfter('soon', NOW), null);
});

test('parseRetryAfter caps a huge delay at one day', () => {
  assert.equal(parseRetryAfter('99999999', NOW), NOW + 86400000);
});

test('parseJsonBody returns the value or reports malformed text', () => {
  assert.deepEqual(parseJsonBody(reply(200, '{"a":1}')), { ok: true, value: { a: 1 } });
  assert.deepEqual(parseJsonBody(reply(200, '{"a":')), { ok: false });
  assert.deepEqual(parseJsonBody(reply(200, '')), { ok: false });
  assert.deepEqual(parseJsonBody({ kind: 'timeout' }), { ok: false });
});

test('failure builds a plain error object with an optional retry time and parameters', () => {
  assert.deepEqual(failure(ERROR_KIND.NO_KEY, REASON.NO_KEY), { kind: 'no_key', reason: 'no_key', retryAt: null, params: {} });
  assert.deepEqual(failure(ERROR_KIND.RATE_LIMITED, REASON.HTTP_STATUS, 5, { status: 429 }), { kind: 'rate_limited', reason: 'http_status', retryAt: 5, params: { status: 429 } });
});
