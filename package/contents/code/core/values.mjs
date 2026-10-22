const DECIMAL_PATTERN = /^-?\d+(\.\d+)?([eE][-+]?\d+)?$/;
const ISO_TIME_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;
const HEX = 16;

export function toFiniteNumber(value) {
  const number = typeof value === 'number' ? value : (typeof value === 'string' && DECIMAL_PATTERN.test(value) ? Number(value) : NaN);
  return Number.isFinite(number) ? number : null;
}

export function parseIsoTime(value) {
  if (typeof value !== 'string' || !ISO_TIME_PATTERN.test(value)) {
    return null;
  }
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : null;
}

export function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function randomHex(digits, random) {
  const next = random || Math.random;
  let text = '';
  for (let index = 0; index < digits; index += 1) {
    text += Math.floor(next() * HEX).toString(HEX);
  }
  return text;
}
