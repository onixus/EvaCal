import { GroundingPack } from '../../grounding';
import { TZ_AUTHOR_SYSTEM_PROMPT } from './system';
import { buildUserPrompt } from './user';
import { TzAuthorResponse } from './responseSchema';

export const TZ_AUTHOR_V1_CONFIG = {
  version: 'tz-author-v1' as const,
  temperature: 0.15,
  responseFormat: 'json' as const,
};

export function buildTzAuthorPromptMessages(pack: GroundingPack): Array<{
  role: 'system' | 'user';
  content: string;
}> {
  return [
    { role: 'system', content: TZ_AUTHOR_SYSTEM_PROMPT },
    { role: 'user', content: buildUserPrompt(pack) },
  ];
}

export * from './system';
export * from './user';
export * from './responseSchema';
