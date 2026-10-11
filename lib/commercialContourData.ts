/**
 * Загрузка коммерческого контура расчёта (#103 §4.2–4.3, #101 §3): закреплённая
 * спецификация, статьи затрат, итог КП и порог маржи. Вся арифметика — в
 * `lib/supply.ts`, `lib/commercial.ts`, `lib/discountApproval.ts`.
 */
import { prisma } from '@/lib/prisma';
import type { Prisma } from '@/lib/generated/prisma/client';
import { calculateCommercialSummary, type CommercialSummary } from '@/lib/commercial';
import {
  buildSupply,
  COST_ITEM_KINDS,
  type CostItemInput,
  type SupplyBreakdown,
} from '@/lib/supply';
import { marginGate, type MarginGate } from '@/lib/discountApproval';
import { offerFingerprint } from '@/lib/offerFingerprint';
import { lockCalculationLedger } from '@/lib/actualsLedgerData';
import { parseSpecification, isDecimal, RATE_RE } from '@/lib/specification/validation';
import { normalizeDecimal } from '@/lib/specification/totals';
import { FINAL_SPECIFICATION_STATUSES } from '@/lib/specification/types';

export class CommercialContourError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

type DecimalLike = { toFixed: () => string } | null;

/** Decimal из БД → каноническая десятичная строка (без экспоненты). */
export function decimalString(value: DecimalLike): string | null {
  return value === null ? null : normalizeDecimal(value.toFixed());
}

const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

/** Клиент БД: общий или транзакция (утверждение читает контур под блокировкой). */
type Db = Prisma.TransactionClient;

export async function loadCostItems(
  calculationId: string,
  db: Db = prisma,
): Promise<CostItemInput[]> {
  const rows = await db.costItem.findMany({
    where: { calculationId },
    orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
  });
  return rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    description: r.description,
    quantity: decimalString(r.quantity) ?? '0',
    unitCost: decimalString(r.unitCost),
    currency: r.currency,
    exchangeRate: decimalString(r.exchangeRate),
    exchangeRateDate: day(r.exchangeRateDate),
    exchangeRateSource: r.exchangeRateSource,
    specItemRef: r.specItemRef,
    order: r.order,
  }));
}

/** Закреплённая редакция: только подтверждённая/выпущенная редакция этого расчёта. */
export async function loadPinnedSpecification(
  calculationId: string,
  version: number | null | undefined,
  db: Db = prisma,
) {
  if (version === null || version === undefined) return null;
  const row = await db.specificationVersion.findUnique({
    where: { calculationId_version: { calculationId, version } },
  });
  if (!row || !(FINAL_SPECIFICATION_STATUSES as readonly string[]).includes(row.status)) {
    throw new CommercialContourError(
      `Закреплённая редакция спецификации v${version} не найдена или не подтверждена`,
      409,
    );
  }
  const snapshot = parseSpecification(JSON.parse(row.data));
  return { version, items: snapshot.items, exchangeRates: snapshot.exchangeRates };
}

interface SupplyCalc {
  id: string;
  currency: string;
  vatPercent: number;
  includeVat: boolean;
  pinnedSpecificationVersion?: number | null;
}

/**
 * Поставка и статьи КП. null — ни спецификация не закреплена, ни статей нет:
 * КП считается только по труду, как исторические расчёты.
 */
export async function loadSupply(
  calc: SupplyCalc,
  db: Db = prisma,
  preloadedCostItems?: CostItemInput[],
): Promise<SupplyBreakdown | null> {
  const costItems = preloadedCostItems ?? (await loadCostItems(calc.id, db));
  const specification = await loadPinnedSpecification(calc.id, calc.pinnedSpecificationVersion, db);
  if (!specification && costItems.length === 0) return null;
  return buildSupply({
    currency: calc.currency,
    vatPercent: calc.vatPercent,
    includeVat: calc.includeVat,
    specification,
    costItems,
  });
}

export interface CommercialState {
  calculationId: string;
  status: string;
  /** Метка версии строки расчёта: утверждение обновляет его, только если она не изменилась. */
  updatedAt: string;
  /** Отпечаток условий КП (lib/offerFingerprint.ts). */
  fingerprint: string;
  pinnedSpecificationVersion: number | null;
  minMarginPercent: number | null;
  discountPercent: number;
  summary: CommercialSummary;
  gate: MarginGate;
  approvals: {
    id: string;
    status: string;
    requestedPercent: number;
    resultingMargin: number | null;
    minMarginPercent: number;
    requestedBy: string;
    comment: string | null;
    decidedBy: string | null;
    decidedAt: string | null;
    decisionComment: string | null;
    createdAt: string;
  }[];
  /** Редакции спецификации, которые можно закрепить. */
  finalSpecificationVersions: number[];
  /** Ошибка пересчёта (например, недопустимые сохранённые условия). */
  error: string | null;
}

export async function loadCommercialState(
  calculationId: string,
  db: Db = prisma,
): Promise<CommercialState | null> {
  const calc = await db.calculation.findUnique({
    where: { id: calculationId },
    include: {
      stages: { orderBy: { order: 'asc' } },
      risks: { orderBy: { order: 'asc' } },
      discountApprovals: { orderBy: { createdAt: 'desc' } },
      specifications: { select: { version: true, status: true }, orderBy: { version: 'desc' } },
    },
  });
  if (!calc) return null;
  let summary: CommercialSummary;
  let error: string | null = null;
  let supply: SupplyBreakdown | null = null;
  const costItems = await loadCostItems(calc.id, db);
  try {
    supply = await loadSupply(calc, db, costItems);
  } catch (e) {
    error = e instanceof Error ? e.message : 'Не удалось загрузить поставку';
  }
  try {
    summary = calculateCommercialSummary(calc.stages, calc.pmHours, calc.risks, {
      ...calc,
      supply,
    });
  } catch (e) {
    // Недопустимые сохранённые условия: показываем ошибку, а цифры — только
    // как справку по наценке, гейт считает маржу неопределённой.
    error = error ?? (e instanceof Error ? e.message : 'Не удалось рассчитать КП');
    summary = calculateCommercialSummary(calc.stages, calc.pmHours, calc.risks, {
      ...calc,
      pricingMode: 'markup',
      supply,
    });
  }
  const fingerprint = offerFingerprint(
    {
      pinnedSpecificationVersion: calc.pinnedSpecificationVersion,
      costItems,
      pricingMode: calc.pricingMode,
      marginPercent: calc.marginPercent,
      overheadPercent: calc.overheadPercent,
      discountPercent: calc.discountPercent,
      vatPercent: calc.vatPercent,
      includeVat: calc.includeVat,
      currency: calc.currency,
      roleRates: calc.roleRates,
      error,
    },
    summary,
  );
  const gate = marginGate({
    minMarginPercent: calc.minMarginPercent,
    marginPercent: error ? null : summary.total.marginPercent,
    incomplete: Boolean(error) || summary.total.incomplete,
    discountPercent: calc.discountPercent,
    fingerprint,
    approvals: calc.discountApprovals,
  });
  return {
    calculationId: calc.id,
    status: calc.status,
    updatedAt: calc.updatedAt.toISOString(),
    fingerprint,
    pinnedSpecificationVersion: calc.pinnedSpecificationVersion,
    minMarginPercent: calc.minMarginPercent,
    discountPercent: calc.discountPercent,
    summary,
    gate,
    approvals: calc.discountApprovals.map((a) => ({
      id: a.id,
      status: a.status,
      requestedPercent: a.requestedPercent,
      resultingMargin: a.resultingMargin,
      minMarginPercent: a.minMarginPercent,
      requestedBy: a.requestedBy,
      comment: a.comment,
      decidedBy: a.decidedBy,
      decidedAt: a.decidedAt?.toISOString() ?? null,
      decisionComment: a.decisionComment,
      createdAt: a.createdAt.toISOString(),
    })),
    finalSpecificationVersions: calc.specifications
      .filter((s) => (FINAL_SPECIFICATION_STATUSES as readonly string[]).includes(s.status))
      .map((s) => s.version),
    error,
  };
}

// ---------------------------------------------------------------------------
// Ввод статей затрат
// ---------------------------------------------------------------------------

function str(v: unknown, field: string, max: number, required = true): string {
  if (v === undefined || v === null) {
    if (required) throw new CommercialContourError(`${field}: обязательно`);
    return '';
  }
  if (typeof v !== 'string' || v.length > max)
    throw new CommercialContourError(`${field}: строка до ${max} символов`);
  const t = v.trim();
  if (required && !t) throw new CommercialContourError(`${field}: обязательно`);
  return t;
}

/** Разбор статьи затрат. Денежные значения — точные десятичные строки. */
export function parseCostItemInput(
  body: unknown,
  calcCurrency: string,
): Omit<Prisma.CostItemUncheckedCreateInput, 'calculationId'> {
  if (!body || typeof body !== 'object' || Array.isArray(body))
    throw new CommercialContourError('Требуется объект статьи');
  const b = body as Record<string, unknown>;
  if (!(COST_ITEM_KINDS as readonly unknown[]).includes(b.kind))
    throw new CommercialContourError(
      'Вид статьи: subcontractor, travel, equipment, license, other',
    );
  const description = str(b.description, 'Описание', 500);
  if (!isDecimal(b.quantity))
    throw new CommercialContourError('Количество: неотрицательное десятичное число');
  const unitCost =
    b.unitCost === null || b.unitCost === '' || b.unitCost === undefined ? null : b.unitCost;
  if (unitCost !== null && !isDecimal(unitCost))
    throw new CommercialContourError(
      'Стоимость за единицу: неотрицательное число или пусто (неизвестно)',
    );
  const currency = str(b.currency, 'Валюта', 3);
  if (!/^[A-Z]{3}$/.test(currency)) throw new CommercialContourError('Валюта: код из 3 букв');
  let exchangeRate: string | null = null;
  let exchangeRateDate: Date | null = null;
  let exchangeRateSource: string | null = null;
  if (b.exchangeRate !== undefined && b.exchangeRate !== null && b.exchangeRate !== '') {
    if (currency === calcCurrency)
      throw new CommercialContourError('Курс не нужен: валюта статьи совпадает с валютой КП');
    if (
      typeof b.exchangeRate !== 'string' ||
      !RATE_RE.test(b.exchangeRate) ||
      !/[1-9]/.test(b.exchangeRate)
    )
      throw new CommercialContourError('Курс: положительное число, до 8 знаков после точки');
    const date = str(b.exchangeRateDate, 'Дата курса', 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`)))
      throw new CommercialContourError('Дата курса: ГГГГ-ММ-ДД');
    exchangeRate = b.exchangeRate;
    exchangeRateDate = new Date(`${date}T00:00:00Z`);
    exchangeRateSource = str(b.exchangeRateSource, 'Источник курса', 200);
  }
  const specItemRef = str(b.specItemRef, 'Строка спецификации', 100, false) || null;
  const order = b.order === undefined ? 0 : Number(b.order);
  if (!Number.isSafeInteger(order) || order < 0)
    throw new CommercialContourError('Порядок: неотрицательное целое');
  return {
    kind: b.kind as string,
    description,
    quantity: b.quantity as string,
    unitCost: unitCost as string | null,
    currency,
    exchangeRate,
    exchangeRateDate,
    exchangeRateSource,
    specItemRef,
    order,
  };
}

/** Коммерческие условия меняются только у неутверждённого расчёта. */
export async function requireEditableCalculation(calculationId: string, db: Db = prisma) {
  const calc = await db.calculation.findUnique({
    where: { id: calculationId },
    select: { id: true, status: true, currency: true, discountPercent: true },
  });
  if (!calc) throw new CommercialContourError('Расчёт не найден', 404);
  if (calc.status === 'approved')
    throw new CommercialContourError(
      'Расчёт утверждён: КП не меняется, создайте новую версию',
      409,
    );
  return calc;
}

/**
 * Запись контура КП под блокировкой расчёта — той же, что у перестройки
 * этапов и журнала факта. Утверждение, заявки, решения, статьи и закрепление
 * спецификации выполняются последовательно: проверка условий и запись не
 * разделяются чужой правкой.
 */
export function withCommercialLock<T>(
  calculationId: string,
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  return prisma.$transaction(
    async (tx) => {
      await lockCalculationLedger(tx, calculationId);
      return fn(tx);
    },
    { timeout: 30_000, maxWait: 10_000 },
  );
}
