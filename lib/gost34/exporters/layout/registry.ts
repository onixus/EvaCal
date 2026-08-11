import { LayoutProfile, LayoutProfileId } from './types';
import { GOST34_MODERN_LAYOUT } from './profiles/gost34Modern';
import { GOST34_ESKD_FRAME_LAYOUT } from './profiles/gost34EskdFrame';
import { PLAIN_CORPORATE_LAYOUT } from './profiles/plainCorporate';

export const LAYOUT_PROFILES: Record<LayoutProfileId, LayoutProfile> = {
  'gost34-modern': GOST34_MODERN_LAYOUT,
  'gost34-eskd-frame': GOST34_ESKD_FRAME_LAYOUT,
  'plain-corporate': PLAIN_CORPORATE_LAYOUT,
};

/**
 * По умолчанию документы выпускаются с рамками и штампами ЕСКД (ГОСТ 2.104-2006):
 * это ожидаемое «гостовское» оформление. Современный стиль без рамок доступен
 * явным выбором профиля `gost34-modern`.
 */
export const DEFAULT_LAYOUT_PROFILE: LayoutProfile = GOST34_ESKD_FRAME_LAYOUT;

export function getLayoutProfile(id?: string): LayoutProfile {
  const resolved = resolveLayoutProfileId(id);
  return resolved ? LAYOUT_PROFILES[resolved] : DEFAULT_LAYOUT_PROFILE;
}

/**
 * Нормализует идентификатор профиля оформления, пришедший из запроса.
 * Неизвестное значение отбрасывается, чтобы сработал профиль по умолчанию.
 */
export function resolveLayoutProfileId(id?: string | null): LayoutProfileId | undefined {
  if (!id) return undefined;
  // Именно собственное свойство: иначе `constructor` или `toString` из
  // Object.prototype прошли бы как валидный профиль и уронили экспорт.
  return Object.hasOwn(LAYOUT_PROFILES, id) ? (id as LayoutProfileId) : undefined;
}
