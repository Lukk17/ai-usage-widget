import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  MIN_TEXT_CONTRAST,
  CARD_TINT_ALPHA,
  relativeLuminance,
  contrastRatio,
  mix,
  cardBackground,
  readableOn,
} from '../../package/contents/code/core/contrast.mjs';

function rgb(r, g, b) {
  return { r: r / 255, g: g / 255, b: b / 255 };
}

function hue(color) {
  const max = Math.max(color.r, color.g, color.b);
  const min = Math.min(color.r, color.g, color.b);
  if (max === min) {
    return null;
  }
  const d = max - min;
  const h = max === color.r ? ((color.g - color.b) / d) % 6 : (max === color.g ? (color.b - color.r) / d + 2 : (color.r - color.g) / d + 4);
  return (h * 60 + 360) % 360;
}

const LAYAN_RED = rgb(191, 3, 3);
const LAYAN_YELLOW = rgb(176, 128, 0);
const LAYAN_BACKGROUND = rgb(49, 49, 58);
const LAYAN_TEXT = rgb(234, 234, 234);

test('relative luminance and contrast follow the WCAG formulas', () => {
  assert.equal(relativeLuminance(rgb(0, 0, 0)), 0);
  assert.equal(relativeLuminance(rgb(255, 255, 255)), 1);
  assert.equal(contrastRatio(rgb(0, 0, 0), rgb(255, 255, 255)), 21);
  assert.equal(contrastRatio(rgb(255, 255, 255), rgb(0, 0, 0)), 21);
  assert.equal(Math.round(contrastRatio(rgb(118, 118, 118), rgb(255, 255, 255)) * 100) / 100, 4.54);
});

test('the card background is the theme background tinted with the text colour', () => {
  assert.equal(CARD_TINT_ALPHA, 0.06);
  assert.deepEqual(cardBackground(rgb(0, 0, 0), rgb(255, 255, 255)), { r: 0.06, g: 0.06, b: 0.06 });
  assert.deepEqual(mix(rgb(0, 0, 0), rgb(255, 255, 255), 0.5), { r: 0.5, g: 0.5, b: 0.5 });
});

test('dark red 191,3,3 on the dark Layan card is lightened, keeps its hue and reaches 4.5 to 1', () => {
  const card = cardBackground(LAYAN_BACKGROUND, LAYAN_TEXT);
  const before = contrastRatio(LAYAN_RED, card);
  const fixed = readableOn(LAYAN_RED, card);
  const after = contrastRatio(fixed, card);
  console.log('191,3,3 on the Layan card: before ' + before.toFixed(2) + ' to 1, after ' + after.toFixed(2) + ' to 1, colour ' + [fixed.r, fixed.g, fixed.b].map((v) => Math.round(v * 255)).join(','));
  assert.ok(before < MIN_TEXT_CONTRAST);
  assert.ok(after >= MIN_TEXT_CONTRAST);
  assert.ok(Math.abs(hue(fixed) - hue(LAYAN_RED)) < 0.5);
  assert.ok(relativeLuminance(fixed) > relativeLuminance(LAYAN_RED));
});

test('dark red is also readable on a plain black background', () => {
  assert.ok(contrastRatio(readableOn(LAYAN_RED, rgb(0, 0, 0)), rgb(0, 0, 0)) >= MIN_TEXT_CONTRAST);
});

test('the Layan warning yellow is lightened the same way when it is too dark', () => {
  const card = cardBackground(LAYAN_BACKGROUND, LAYAN_TEXT);
  const fixed = readableOn(LAYAN_YELLOW, card);
  assert.ok(contrastRatio(fixed, card) >= MIN_TEXT_CONTRAST);
  assert.ok(Math.abs(hue(fixed) - hue(LAYAN_YELLOW)) < 0.5);
});

test('on a light theme a readable colour is left as it is', () => {
  const breezeRed = rgb(218, 68, 83);
  const darkRed = rgb(150, 20, 30);
  const light = cardBackground(rgb(239, 240, 241), rgb(35, 38, 41));
  assert.deepEqual(readableOn(darkRed, light), darkRed);
  const fixed = readableOn(breezeRed, light);
  assert.ok(contrastRatio(fixed, light) >= MIN_TEXT_CONTRAST);
  assert.ok(relativeLuminance(fixed) < relativeLuminance(breezeRed), 'on a light card a pale colour is darkened, not lightened');
});

test('a ratio that cannot be reached falls back to white or black', () => {
  assert.deepEqual(readableOn(rgb(128, 128, 128), rgb(128, 128, 128), 25), { r: 1, g: 1, b: 1 });
  assert.deepEqual(readableOn(rgb(200, 200, 200), rgb(220, 220, 220), 25), { r: 0, g: 0, b: 0 });
});
