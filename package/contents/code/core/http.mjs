import { SECOND_MS, DAY_MS } from './units.mjs';

export const ERROR_KIND = Object.freeze({
  CANNOT_CONNECT: 'cannot_connect',
  KEY_REJECTED: 'key_rejected',
  RATE_LIMITED: 'rate_limited',
  UNEXPECTED_ANSWER: 'unexpected_answer',
  NOT_AVAILABLE: 'not_available',
  NO_KEY: 'no_key',
});

export const REASON = Object.freeze({
  TIMEOUT: 'timeout',
  NO_CONNECTION: 'no_connection',
  CURL_ERROR: 'curl_error',
  REQUEST_TIMEOUT: 'request_timeout',
  COMMAND_FAILED: 'command_failed',
  INCOMPLETE: 'incomplete',
  TOOL_MISSING: 'tool_missing',
  ANSWER_TOO_LARGE: 'answer_too_large',
  HTTP_STATUS: 'http_status',
  SERVICE_ERROR: 'service_error',
  PAYMENT_REQUIRED: 'payment_required',
  REDIRECT: 'redirect',
  SHAPE_CHANGED: 'shape_changed',
  SERVICE_CODE: 'service_code',
  INTERNAL: 'internal',
  NO_KEY: 'no_key',
  KEY_FORMAT: 'key_format',
  SECRET_SERVICE_TIMEOUT: 'secret_service_timeout',
  SECRET_SERVICE_UNAVAILABLE: 'secret_service_unavailable',
  WALLET_LOCKED: 'wallet_locked',
  TEAM_ORGANIZATION_REQUIRED: 'team_organization_required',
  ADMIN_KEY_REQUIRED: 'admin_key_required',
  OPENAI_ADMIN_KEY_REQUIRED: 'openai_admin_key_required',
  GO_SUBSCRIPTION_REQUIRED: 'go_subscription_required',
  ZEN_ALL_PERMISSIONS: 'zen_all_permissions',
  BALANCE_EXHAUSTED: 'balance_exhausted',
  BALANCE_NEEDS_MANAGE: 'balance_needs_manage',
  INSUFFICIENT_BALANCE: 'insufficient_balance',
  FILE_READ_FAILED: 'file_read_failed',
  FILE_TOO_LARGE: 'file_too_large',
  FILE_FORMAT_CHANGED: 'file_format_changed',
  CLAUDE_FILE_MISSING: 'claude_file_missing',
  CLAUDE_ORG_MISSING: 'claude_org_missing',
  CODEX_MISSING: 'codex_missing',
  CODEX_NO_LIMITS: 'codex_no_limits',
  FIELD_MISSING: 'field_missing',
  HF_BILLING_PERMISSION: 'hf_billing_permission',
  JETBRAINS_LOG_MISSING: 'jetbrains_log_missing',
  JETBRAINS_NO_QUOTA: 'jetbrains_no_quota',
});

const MAX_RETRY_AFTER_MS = DAY_MS;
const DELAY_SECONDS_PATTERN = /^\d+$/;
const HTTP_DATE_PATTERN = /^[A-Za-z]{3},? /;

export function failure(kind, reason, retryAt, params) {
  return { kind: kind, reason: reason, retryAt: retryAt === undefined ? null : retryAt, params: params || {} };
}

export function parseRetryAfter(value, now) {
  if (typeof value !== 'string' || value.trim() === '') {
    return null;
  }
  const text = value.trim();
  if (DELAY_SECONDS_PATTERN.test(text)) {
    return now + Math.min(Number(text) * SECOND_MS, MAX_RETRY_AFTER_MS);
  }
  const date = HTTP_DATE_PATTERN.test(text) ? Date.parse(text) : NaN;
  if (!Number.isFinite(date)) {
    return null;
  }
  return Math.min(Math.max(date, now), now + MAX_RETRY_AFTER_MS);
}

function isResponse(reply) {
  return Boolean(reply) && reply.kind === 'response' && Number.isFinite(reply.status);
}

function classifyStatus(reply, now) {
  const status = reply.status;
  if (status >= 200 && status < 300) {
    return null;
  }
  if (status >= 300 && status < 400) {
    return failure(ERROR_KIND.UNEXPECTED_ANSWER, REASON.REDIRECT, null, { status: status });
  }
  if (status === 401 || status === 403) {
    return failure(ERROR_KIND.KEY_REJECTED, REASON.HTTP_STATUS, null, { status: status });
  }
  if (status === 402) {
    return failure(ERROR_KIND.NOT_AVAILABLE, REASON.PAYMENT_REQUIRED);
  }
  if (status === 429) {
    return failure(ERROR_KIND.RATE_LIMITED, REASON.HTTP_STATUS, parseRetryAfter(reply.header('Retry-After'), now), { status: status });
  }
  if (status >= 500) {
    return failure(ERROR_KIND.CANNOT_CONNECT, REASON.SERVICE_ERROR, parseRetryAfter(reply.header('Retry-After'), now), { status: status });
  }
  return failure(ERROR_KIND.UNEXPECTED_ANSWER, REASON.HTTP_STATUS, null, { status: status });
}

function classifyTransportFailure(reply) {
  switch (reply.kind) {
    case 'timeout':
      return failure(ERROR_KIND.CANNOT_CONNECT, REASON.TIMEOUT);
    case 'network':
      return failure(ERROR_KIND.CANNOT_CONNECT, REASON.NO_CONNECTION);
    case 'too_large':
      return failure(ERROR_KIND.UNEXPECTED_ANSWER, REASON.ANSWER_TOO_LARGE);
    case 'incomplete':
      return failure(ERROR_KIND.CANNOT_CONNECT, REASON.INCOMPLETE);
    case 'tool_missing':
      return failure(ERROR_KIND.CANNOT_CONNECT, REASON.TOOL_MISSING);
    case 'curl_error':
      return failure(ERROR_KIND.CANNOT_CONNECT, REASON.CURL_ERROR, null, { code: reply.code });
    default:
      return failure(ERROR_KIND.UNEXPECTED_ANSWER, REASON.INTERNAL);
  }
}

export function classifyReply(reply, now, override) {
  if (!reply) {
    return failure(ERROR_KIND.UNEXPECTED_ANSWER, REASON.INTERNAL);
  }
  if (!isResponse(reply)) {
    return classifyTransportFailure(reply);
  }
  const overridden = override ? override(reply) : null;
  return overridden || classifyStatus(reply, now);
}

export function parseJsonBody(reply) {
  if (!isResponse(reply) || typeof reply.body !== 'string') {
    return { ok: false };
  }
  try {
    return { ok: true, value: JSON.parse(reply.body) };
  } catch (error) {
    return { ok: false };
  }
}
