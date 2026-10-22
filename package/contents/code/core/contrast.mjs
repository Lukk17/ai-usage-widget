export const MIN_TEXT_CONTRAST = 4.5;
export const CARD_TINT_ALPHA = 0.06;

const STEPS = 100;
const LINEAR_LIMIT = 0.04045;
const LINEAR_DIVISOR = 12.92;
const GAMMA_OFFSET = 0.055;
const GAMMA_DIVISOR = 1.055;
const GAMMA = 2.4;
const RED_WEIGHT = 0.2126;
const GREEN_WEIGHT = 0.7152;
const BLUE_WEIGHT = 0.0722;
const LUMINANCE_OFFSET = 0.05;
const MIDDLE_LUMINANCE = 0.5;
const WHITE = Object.freeze({ r: 1, g: 1, b: 1 });
const BLACK = Object.freeze({ r: 0, g: 0, b: 0 });

function channel(value) {
  return value <= LINEAR_LIMIT ? value / LINEAR_DIVISOR : Math.pow((value + GAMMA_OFFSET) / GAMMA_DIVISOR, GAMMA);
}

export function relativeLuminance(color) {
  return RED_WEIGHT * channel(color.r) + GREEN_WEIGHT * channel(color.g) + BLUE_WEIGHT * channel(color.b);
}

export function contrastRatio(first, second) {
  const a = relativeLuminance(first);
  const b = relativeLuminance(second);
  return (Math.max(a, b) + LUMINANCE_OFFSET) / (Math.min(a, b) + LUMINANCE_OFFSET);
}

export function mix(from, to, amount) {
  return {
    r: from.r + (to.r - from.r) * amount,
    g: from.g + (to.g - from.g) * amount,
    b: from.b + (to.b - from.b) * amount,
  };
}

export function cardBackground(background, tint) {
  return mix(background, tint, CARD_TINT_ALPHA);
}

export function readableOn(color, background, minRatio) {
  const wanted = minRatio || MIN_TEXT_CONTRAST;
  const plain = { r: color.r, g: color.g, b: color.b };
  if (contrastRatio(plain, background) >= wanted) {
    return plain;
  }
  const target = relativeLuminance(background) < MIDDLE_LUMINANCE ? WHITE : BLACK;
  for (let step = 1; step <= STEPS; step += 1) {
    const candidate = mix(plain, target, step / STEPS);
    if (contrastRatio(candidate, background) >= wanted) {
      return candidate;
    }
  }
  return { r: target.r, g: target.g, b: target.b };
}
