import { ERROR_KIND, REASON, failure, classifyReply } from './http.mjs';
import { buildCheckCommand, parseCheckOutput, commandTimeoutMs } from './curlCommand.mjs';
import { unexpected } from './usage.mjs';

function latestRetry(failures) {
  return failures.reduce((latest, item) => {
    if (item.retryAt === null) {
      return latest;
    }
    return latest === null ? item.retryAt : Math.max(latest, item.retryAt);
  }, null);
}

function evaluate(provider, requests, replies, now) {
  const results = {};
  const rateLimits = [];
  let requiredFailure = null;
  requests.forEach((request, index) => {
    const error = classifyReply(replies[index], now, provider.classify);
    results[request.id] = { reply: replies[index], error: error };
    if (error && error.kind === ERROR_KIND.RATE_LIMITED) {
      rateLimits.push(error);
    } else if (error && !request.optional && requiredFailure === null) {
      requiredFailure = error;
    }
  });
  if (rateLimits.length > 0) {
    const first = rateLimits[0];
    return { ok: false, error: failure(first.kind, first.reason, latestRetry(rateLimits), first.params) };
  }
  if (requiredFailure) {
    return { ok: false, error: requiredFailure };
  }
  return provider.interpret(results, now);
}

export function fetchUsage(provider, account, runCommand, clock, boundary) {
  let requests;
  let command;
  try {
    requests = provider.buildRequests(clock(), account);
    command = buildCheckCommand({ providerId: provider.id, account: account.id, auth: provider.auth, requests: requests, boundary: boundary });
  } catch (error) {
    return Promise.resolve(unexpected(REASON.INTERNAL));
  }
  return Promise.resolve()
    .then(() => runCommand(command, commandTimeoutMs(requests.length)))
    .then((result) => {
      const parsed = parseCheckOutput(result, requests, boundary);
      if (!parsed.ok) {
        return { ok: false, error: parsed.error };
      }
      try {
        return evaluate(provider, requests, parsed.replies, clock());
      } catch (error) {
        return unexpected(REASON.INTERNAL);
      }
    }, () => ({ ok: false, error: failure(ERROR_KIND.CANNOT_CONNECT, REASON.COMMAND_FAILED) }));
}
