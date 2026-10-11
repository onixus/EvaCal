/**
 * Происхождение элемента проекта из набора решений (#103 WP-7b).
 *
 * Этапы и риски расчёта хранят его строкой `originRef`
 * (`kit:<kitId>@<version>#<elementId>`, CHECK в миграции), требования
 * комплекта — объектом `origin` (`KitElementOrigin` в
 * `lib/gost34/requirements/v2.ts`), проверки и фрагменты — в реестрах снимка
 * (`kitChecks`, `kitFragments`). По `{kitId, elementId}` проект сопоставляется с
 * любой версией набора: elementId стабилен между версиями.
 */
import type { KitElementOrigin } from '@/lib/gost34/requirements/v2';

export type { KitElementOrigin };

export const ORIGIN_REF_PATTERN = /^kit:([^@#]+)@(\d+)#(.+)$/;

export function formatOriginRef(o: {
  kitId: string;
  kitVersion: number;
  elementId: string;
}): string {
  return `kit:${o.kitId}@${o.kitVersion}#${o.elementId}`;
}

export function parseOriginRef(
  ref: string | null | undefined,
): { kitId: string; kitVersion: number; elementId: string } | null {
  if (!ref) return null;
  const m = ORIGIN_REF_PATTERN.exec(ref);
  if (!m) return null;
  return { kitId: m[1], kitVersion: Number(m[2]), elementId: m[3] };
}

/** Объект происхождения из снимка: только корректная форма, иначе null. */
export function readOrigin(raw: unknown): KitElementOrigin | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  if (
    typeof o.kitId !== 'string' ||
    typeof o.kitKey !== 'string' ||
    typeof o.elementId !== 'string' ||
    typeof o.kitVersion !== 'number' ||
    !Number.isInteger(o.kitVersion)
  ) {
    return null;
  }
  return { kitId: o.kitId, kitKey: o.kitKey, kitVersion: o.kitVersion, elementId: o.elementId };
}

/** id требования, созданного из набора: детерминирован (воспроизводимость). */
export function kitRequirementId(kitKey: string, elementId: string): string {
  return `kit.${kitKey}.${elementId}`;
}
