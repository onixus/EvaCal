export * from './types';
export * from './profiles';

import { GOST34_PROFILES } from './profiles';

export function getGost34Profile(id: string) {
  return GOST34_PROFILES.find((profile) => profile.id === id);
}

export const DEFAULT_GOST34_PROFILE = GOST34_PROFILES[0];
