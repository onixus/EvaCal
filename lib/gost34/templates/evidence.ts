// Compliance evidence in SPEC/PZ: only confirmed specification rows with current
// confirmed evidence covering their exact SKU/edition are printed; everything else is
// «Не подтверждено». A brand or vendor alone never implies compliance.
import { businessDate } from '../../catalog/business-date';
import { evidenceText, itemEvidence } from '../../catalog/compliance';
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

export function evidenceAsOf(payload: Pick<Gost34InputPayload, 'evidenceDate'>): string {
  return payload.evidenceDate ?? businessDate(new Date())!;
}

export function itemEvidenceText(item: SpecificationItem, asOf: string): string {
  return evidenceText(itemEvidence(item, asOf));
}

/**
 * Non-blocking gap: confirmed supplied rows that need evidence but have no current
 * confirmed evidence (missing, expired, revoked, stale or for another version/model).
 */
export function evidenceGap(items: SpecificationItem[], asOf: string): ContextGap | null {
  const missing = items.filter(
    (item) =>
      item.confirmed &&
      item.disposition !== 'alternative' &&
      EVIDENCE_KINDS.includes(item.kind) &&
      itemEvidence(item, asOf).current.length === 0,
  );
  if (!missing.length) return null;
  const names = missing.slice(0, 10).map((item) => item.name || item.id);
  return {
    path: 'specification.evidence',
    label: `Действующие подтверждения реестров / сертификатов (${missing.length} поз.: ${names.join(', ')}${missing.length > names.length ? ', …' : ''})`,
    severity: 'minor',
    hint: 'Внесите в каталоге запись реестра или сертификат с источником, датой проверки и точной применимостью, затем повторно подтвердите строку спецификации',
  };
}
