export const LABEL_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,31}$/;

export function isValidLabel(value) {
  return typeof value === 'string' && LABEL_PATTERN.test(value);
}

export function assertValidLabel(value, what) {
  if (!isValidLabel(value)) {
    throw new Error(what + ' name is not allowed: use 1 to 32 letters, digits, - or _, starting with a letter or digit');
  }
  return value;
}
