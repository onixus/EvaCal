// Compliance evidence in SPEC/PZ: only confirmed specification rows with current
// confirmed evidence covering their exact catalog SKU/edition are printed; everything
// else is «Не подтверждено». A brand or vendor alone never implies compliance.
import { businessDate } from '../../catalog/business-date';
import { evidenceDrift, evidenceText, itemEvidence } from '../../catalog/compliance';
import type { ItemKind, SpecificationItem } from '../../specification/types';
import type { ContextGap } from '../context/types';
import type { Gost34InputPayload } from '../types';

/** Kinds for which registry entries / certificates are expected in a final document. */
export const EVIDENCE_KINDS: readonly ItemKind[] = [
  'software',
  'license',
  'subscription',
  'hardware',
  'bundle',
];
const REFRESH_HINT =
  'Внесите или исправьте запись в каталоге («Реестры и сертификаты» позиции), затем в спецификации нажмите «Обновить сведения реестров» и сохраните новую редакцию';

/** Business date of evaluation: expiry and stale checks are judged on the generation day. */
export function evidenceAsOf(): string {
  return businessDate(new Date())!;
}

export function itemEvidenceText(item: SpecificationItem, asOf: string): string {
  return evidenceText(itemEvidence(item, asOf));
}

const names = (list: string[]) =>
  `${list.length} поз.: ${list.slice(0, 10).join(', ')}${list.length > 10 ? ', …' : ''}`;

/**
 * Non-blocking gaps: confirmed supplied rows that need evidence but have no current
 * confirmed evidence; and (non-released revisions only, when the live catalog state is
 * known) copies that no longer match the catalog records.
 */
export function evidenceGaps(
  items: SpecificationItem[],
  asOf: string,
  live?: Gost34InputPayload['evidenceLive'],
): ContextGap[] {
  const gaps: ContextGap[] = [];
  const missing = items
    .filter(
      (item) =>
        item.confirmed &&
        item.disposition === 'supply' &&
        EVIDENCE_KINDS.includes(item.kind) &&
        itemEvidence(item, asOf).current.length === 0,
    )
    .map((item) => item.name || item.id);
  if (missing.length)
    gaps.push({
      path: 'specification.evidence',
      label: `Действующие подтверждения реестров / сертификатов (${names(missing)})`,
      severity: 'minor',
      hint: REFRESH_HINT,
    });
  const drift = live ? evidenceDrift(items, live) : [];
  if (drift.length)
    gaps.push({
      path: 'specification.evidence-drift',
      label: `Сведения реестров / сертификатов изменились в каталоге после копирования (${names(drift)})`,
      severity: 'minor',
      hint: 'Нажмите «Обновить сведения реестров» в спецификации: копии в редакции обновятся по каталогу',
    });
  return gaps;
}
