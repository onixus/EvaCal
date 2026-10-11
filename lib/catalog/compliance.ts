// Client-safe rules for compliance evidence (registry entries and certificates).
// Evidence is recorded manually per catalog product; nothing here checks registries
// online, and a brand or vendor alone never implies compliance.
import { SpecificationError } from '../specification/validation';
import { businessDate } from './business-date';

// Local helpers (no import of ./validation): specification validation imports this
// module, so it must not depend back on the catalog validators.
function object(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw new SpecificationError('Требуется объект');
  return input as Record<string, unknown>;
}
function text(value: unknown, field: string, max = 200, required = false): string {
  if (typeof value !== 'string' || value.length > max || (required && !value.trim()))
    throw new SpecificationError(`Некорректное поле: ${field} (до ${max} символов)`);
  return value.trim();
}

export const EVIDENCE_TYPES = ['software_registry', 'hardware_registry', 'certificate'] as const;
export type EvidenceType = (typeof EVIDENCE_TYPES)[number];
export const EVIDENCE_TYPE_LABELS: Record<EvidenceType, string> = {
  software_registry: 'Реестр российского ПО',
  hardware_registry: 'Реестр российской промышленной продукции',
  certificate: 'Сертификат соответствия',
};
export const EVIDENCE_STATUSES = ['confirmed', 'expired', 'revoked', 'unverified'] as const;
export type EvidenceStatus = (typeof EVIDENCE_STATUSES)[number];
export const EVIDENCE_STATUS_LABELS: Record<EvidenceStatus, string> = {
  confirmed: 'Подтверждено',
  expired: 'Срок истек',
  revoked: 'Отозвано / исключено',
  unverified: 'Не проверено',
};

export interface EvidenceInput {
  type: EvidenceType;
  number: string;
  issuer: string;
  sourceUrl: string;
  /** ГГГГ-ММ-ДД business date of the manual check. */
  checkedAt: string;
  /** ГГГГ-ММ-ДД; null is unknown/indefinite. */
  validUntil: string | null;
  status: EvidenceStatus;
  /** Exact version/model/edition values the evidence covers, «;»-separated. */
  applicability: string;
  note: string;
}
/** Immutable copy stored in a specification revision. */
export interface EvidenceSnapshot extends Omit<EvidenceInput, 'note'> {
  id: string;
  productId: string;
  productRevision: number | null;
  checkedBy: string;
  /** Revision of the catalog record copied (absent in early copies: treated as outdated). */
  revision?: number;
}
export interface ComplianceEvidence extends EvidenceInput {
  id: string;
  productId: string;
  productRevision: number | null;
  checkedBy: string;
  revision: number;
  createdBy: string;
  createdAt: string;
}

/** Days after which a confirmed check is treated as unverified (env override). */
export const DEFAULT_EVIDENCE_STALE_DAYS = 365;
export function evidenceStaleDays(): number {
  const raw = typeof process !== 'undefined' ? process.env.COMPLIANCE_EVIDENCE_STALE_DAYS : '';
  const days = Number(raw);
  return raw && Number.isSafeInteger(days) && days > 0 ? days : DEFAULT_EVIDENCE_STALE_DAYS;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
function date(value: unknown, field: string): string {
  if (
    typeof value !== 'string' ||
    !DATE.test(value) ||
    !Number.isFinite(Date.parse(`${value}T00:00:00Z`)) ||
    new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value
  )
    throw new SpecificationError(`${field}: дата ГГГГ-ММ-ДД`);
  return value;
}

export function evidenceInput(input: unknown, today = businessDate(new Date())!): EvidenceInput {
  const d = object(input);
  if (!(EVIDENCE_TYPES as readonly unknown[]).includes(d.type))
    throw new SpecificationError('Некорректный тип подтверждения');
  if (!(EVIDENCE_STATUSES as readonly unknown[]).includes(d.status))
    throw new SpecificationError('Некорректный статус подтверждения');
  const sourceUrl = text(d.sourceUrl, 'Ссылка на источник', 1000, true);
  let url: URL | null = null;
  try {
    url = new URL(sourceUrl);
  } catch {
    url = null;
  }
  if (!url || !['http:', 'https:'].includes(url.protocol))
    throw new SpecificationError('Ссылка на источник: адрес http(s)');
  const checkedAt = date(d.checkedAt, 'Дата проверки');
  if (checkedAt > today) throw new SpecificationError('Дата проверки не может быть в будущем');
  const validUntil =
    d.validUntil === null || d.validUntil === undefined || d.validUntil === ''
      ? null
      : date(d.validUntil, 'Действует до');
  const applicability = text(d.applicability, 'Применимость', 500, true);
  if (!applicabilityTokens(applicability).length)
    throw new SpecificationError('Применимость: укажите точную версию, модель или редакцию');
  return {
    type: d.type as EvidenceType,
    number: text(d.number, 'Номер записи / сертификата', 100, true),
    issuer: d.issuer === undefined ? '' : text(d.issuer, 'Орган / реестр', 200),
    sourceUrl,
    checkedAt,
    validUntil,
    status: d.status as EvidenceStatus,
    applicability,
    note: d.note === undefined ? '' : text(d.note, 'Комментарий', 1000),
  };
}

export function applicabilityTokens(applicability: string): string[] {
  return applicability
    .split(/[;\n]/)
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean);
}
/** Exact (case-insensitive) match of one applicability value with a version/model/SKU. */
export function applicabilityMatches(applicability: string, candidates: Array<string | undefined>) {
  const values = new Set(
    candidates.map((c) => (c ?? '').trim().toLowerCase()).filter((c) => c.length > 0),
  );
  return applicabilityTokens(applicability).some((t) => values.has(t));
}

export interface DerivedEvidenceStatus {
  status: EvidenceStatus;
  /** Human-readable reason when the evidence is not currently confirmed. */
  reason: string;
}
function addDays(day: string, days: number) {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
/**
 * Display status on `today` (business date): revoked stays revoked; a passed validUntil
 * means expired; a confirmed check older than `staleDays` is unverified (stale).
 */
export function deriveEvidenceStatus(
  e: Pick<EvidenceInput, 'status' | 'checkedAt' | 'validUntil'>,
  today: string,
  staleDays = evidenceStaleDays(),
): DerivedEvidenceStatus {
  if (e.status === 'revoked') return { status: 'revoked', reason: 'отозвано или исключено' };
  if (e.status === 'expired' || (e.validUntil !== null && e.validUntil < today))
    return {
      status: 'expired',
      reason: `срок действия истек${e.validUntil ? ` ${e.validUntil}` : ''}`,
    };
  if (e.status === 'unverified') return { status: 'unverified', reason: 'не проверено' };
  if (addDays(e.checkedAt, staleDays) < today)
    return {
      status: 'unverified',
      reason: `проверка устарела (проверено ${e.checkedAt}, срок пересверки ${staleDays} дн.)`,
    };
  return { status: 'confirmed', reason: '' };
}

/** Evidence copied into a specification item; null-safe for legacy rows. */
export function snapshotEvidence(e: ComplianceEvidence): EvidenceSnapshot {
  return {
    id: e.id,
    revision: e.revision,
    productId: e.productId,
    productRevision: e.productRevision,
    type: e.type,
    number: e.number,
    issuer: e.issuer,
    sourceUrl: e.sourceUrl,
    checkedAt: e.checkedAt,
    checkedBy: e.checkedBy,
    validUntil: e.validUntil,
    status: e.status,
    applicability: e.applicability,
  };
}

function positive(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1)
    throw new SpecificationError('Некорректная редакция подтверждения');
  return Number(value);
}
/** Strict parse of a stored snapshot (reloaded revisions are validated too). */
export function parseEvidenceSnapshot(input: unknown): EvidenceSnapshot {
  const d = object(input);
  const allowed = [
    'id',
    'productId',
    'productRevision',
    'type',
    'number',
    'issuer',
    'sourceUrl',
    'checkedAt',
    'checkedBy',
    'validUntil',
    'status',
    'applicability',
    'revision',
  ];
  if (Object.keys(d).some((k) => !allowed.includes(k)))
    throw new SpecificationError('Неизвестное поле подтверждения соответствия');
  if (
    d.productRevision !== null &&
    (!Number.isSafeInteger(d.productRevision) || Number(d.productRevision) < 1)
  )
    throw new SpecificationError('Некорректная редакция позиции подтверждения');
  if (!(EVIDENCE_TYPES as readonly unknown[]).includes(d.type))
    throw new SpecificationError('Некорректный тип подтверждения');
  if (!(EVIDENCE_STATUSES as readonly unknown[]).includes(d.status))
    throw new SpecificationError('Некорректный статус подтверждения');
  return {
    id: text(d.id, 'ID подтверждения', 100, true),
    productId: text(d.productId, 'Позиция подтверждения', 100, true),
    productRevision: d.productRevision === null ? null : Number(d.productRevision),
    type: d.type as EvidenceType,
    number: text(d.number, 'Номер', 100, true),
    issuer: text(d.issuer, 'Орган', 200),
    sourceUrl: text(d.sourceUrl, 'Источник', 1000, true),
    checkedAt: date(d.checkedAt, 'Дата проверки'),
    checkedBy: text(d.checkedBy, 'Проверил', 200, true),
    validUntil: d.validUntil === null ? null : date(d.validUntil, 'Действует до'),
    status: d.status as EvidenceStatus,
    applicability: text(d.applicability, 'Применимость', 500, true),
    ...(d.revision === undefined ? {} : { revision: positive(d.revision) }),
  };
}

export interface ItemEvidenceView {
  /** Current confirmed evidence matching the item's version/model/SKU. */
  current: EvidenceSnapshot[];
  /** Why other evidence of the item is not shown as confirmed. */
  problems: string[];
}
/**
 * Evidence of a specification row shown as confirmed only when the row itself is
 * confirmed and the evidence is currently confirmed and covers the row's exact
 * SKU / edition. Everything else is reported, never claimed.
 */
export function itemEvidence(
  item: {
    confirmed: boolean;
    sku: string;
    origin?: { sku: string; edition: string } | undefined;
    evidence?: EvidenceSnapshot[];
  },
  today: string,
  staleDays = evidenceStaleDays(),
): ItemEvidenceView {
  const view: ItemEvidenceView = { current: [], problems: [] };
  if (!item.confirmed) {
    view.problems.push('позиция не подтверждена');
    return view;
  }
  // Applicability is matched against the catalog identity of the row, never the editable SKU.
  if (!item.origin) {
    view.problems.push('ручная позиция: подтверждения ведутся только для позиций каталога');
    return view;
  }
  if (item.sku !== item.origin.sku) {
    view.problems.push('артикул изменен вручную: подтверждения каталога к строке не относятся');
    return view;
  }
  for (const e of item.evidence ?? []) {
    const label = `${EVIDENCE_TYPE_LABELS[e.type]} № ${e.number}`;
    if (!applicabilityMatches(e.applicability, [item.origin.sku, item.origin.edition])) {
      view.problems.push(`${label}: не относится к версии/модели позиции (${e.applicability})`);
      continue;
    }
    const derived = deriveEvidenceStatus(e, today, staleDays);
    if (derived.status === 'confirmed') view.current.push(e);
    else view.problems.push(`${label}: ${derived.reason}`);
  }
  if (!item.evidence?.length) view.problems.push('подтверждения не внесены');
  return view;
}

export const NOT_CONFIRMED = 'Не подтверждено';
/** Text for documents: only current confirmed evidence, otherwise «Не подтверждено». */
export function evidenceText(view: ItemEvidenceView): string {
  if (!view.current.length) return NOT_CONFIRMED;
  return view.current
    .map(
      (e) =>
        `${EVIDENCE_TYPE_LABELS[e.type]} № ${e.number}${e.issuer ? ` (${e.issuer})` : ''}; применимо к: ${e.applicability}; проверено ${e.checkedAt}${e.validUntil ? `, действует до ${e.validUntil}` : ''}; источник: ${e.sourceUrl}`,
    )
    .join('\n');
}

/** Live state of catalog evidence records referenced by a non-released specification. */
export type EvidenceLive = Record<string, { revision: number; archived: boolean }>;
/**
 * Rows whose copied evidence no longer matches the catalog: the record was archived,
 * deleted or edited after the copy. Only meaningful for non-released revisions.
 */
export function evidenceDrift(
  items: Array<{ name: string; id: string; evidence?: EvidenceSnapshot[] }>,
  live: EvidenceLive,
): string[] {
  return items
    .filter((item) =>
      (item.evidence ?? []).some((e) => {
        const current = live[e.id];
        return !current || current.archived || current.revision !== e.revision;
      }),
    )
    .map((item) => item.name || item.id);
}
