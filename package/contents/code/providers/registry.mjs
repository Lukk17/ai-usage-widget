import { claudeDesktop } from './claudeDesktop.mjs';
import { chatgpt } from './chatgpt.mjs';
import { openai } from './openai.mjs';
import { anthropic } from './anthropic.mjs';
import { xai } from './xai.mjs';
import { opencodeGo } from './opencodeGo.mjs';
import { opencodeZen } from './opencodeZen.mjs';
import { minimax } from './minimax.mjs';
import { requesty } from './requesty.mjs';
import { huggingFace } from './huggingFace.mjs';
import { jetbrains } from './jetbrains.mjs';

export const ALL_PROVIDERS = Object.freeze([claudeDesktop, chatgpt, openai, anthropic, xai, opencodeGo, opencodeZen, minimax, requesty, huggingFace, jetbrains]);

export function findProvider(id) {
  const matches = ALL_PROVIDERS.filter((provider) => provider.id === id);
  return matches.length > 0 ? matches[0] : null;
}
