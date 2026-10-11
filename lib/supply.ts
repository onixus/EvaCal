/**
 * Поставка и дополнительные статьи затрат в КП (#103 §4.2, #101 §3): чистая
 * логика без Prisma.
 *
 * Правила (точная десятичная арифметика, масштаб 10^12, как в спецификации):
 * 1. В КП входят только строки `supply` закреплённой подтверждённой редакции
 *    спецификации; компоненты комплекта (`includedIn`) не суммируются ни по цене,
 *    ни по себестоимости — их несёт строка-комплект (правило 3a спецификации).
 * 2. Цена строки = количество × (salePrice ?? unitPrice) × (1 − скидка строки %).
 *    Неизвестное количество или цена — «неизвестно», а не 0: сумма неполная.
 * 3. Себестоимость строки — сумма связанных статей затрат (specItemRef), иначе
 *    количество × purchasePrice; иначе неизвестна. Связанная статья не входит в
 *    наценяемые статьи — двойного учёта нет.
 * 4. Валюта строки ≠ валюте КП — пересчёт только по курсу, сохранённому в
 *    снимке спецификации (для статьи — в самой статье). Нет курса — сумма
 *    неполная, курс 1 не подразумевается. Исходные цены и валюты не меняются.
 * 5. НДС строки — vatRate строки, иначе ставка расчёта; без НДС в КП — 0.
 * 6. Округление до 2 знаков выполняется только для итоговых сумм.
 */
import { fromScaled, isBundleComponent, roundDecimal, toScaled } from './specification/totals';
import type { SpecificationExchangeRate, SpecificationItem } from './specification/types';

export const COST_ITEM_KINDS = [
  'subcontractor',
  'travel',
  'equipment',
  'license',
  'other',
] as const;
export type CostItemKind = (typeof COST_ITEM_KINDS)[number];
export const COST_ITEM_KIND_LABELS: Record<CostItemKind, string> = {
  subcontractor: 'Подрядчик',
  travel: 'Командировка',
  equipment: 'Оборудование',
  license: 'Лицензия',
  other: 'Прочее',
};

export interface CostItemInput {
  id: string;
  kind: string;
  description: string;
  /** Exact decimal string. */
  quantity: string;
  /** Exact decimal string; null — стоимость неизвестна. */
  unitCost: string | null;
  currency: string;
  /** 1 `currency` = exchangeRate валюты КП; обязателен, если валюты различаются. */
  exchangeRate: string | null;
  exchangeRateDate: string | null;
  exchangeRateSource: string | null;
  specItemRef: string | null;
  order: number;
}

export interface SupplyInput {
  /** Валюта КП (расчёта). */
  currency: string;
  vatPercent: number;
  includeVat: boolean;
  specification: {
    version: number;
    items: SpecificationItem[];
    exchangeRates?: SpecificationExchangeRate[];
  } | null;
  costItems: CostItemInput[];
}

export interface AppliedRate {
  rate: string;
  date: string;
  source: string;
}

export interface SupplyLine {
  ref: string;
  name: string;
  kind: string;
  quantity: string | null;
  currency: string;
  /** Цена за единицу для заказчика в исходной валюте (salePrice ?? unitPrice). */
  unitSale: string | null;
  discountPercent: string | null;
  /** Цена строки без НДС в исходной валюте; null — неизвестна. */
  saleOriginal: string | null;
  /** Цена строки без НДС в валюте КП; null — неизвестна или нет курса. */
  sale: string | null;
  /** Себестоимость в валюте КП; null — неизвестна. */
  cost: string | null;
  costSource: 'purchase' | 'cost_items' | null;
  vatPercent: string;
  vat: string | null;
  rate: AppliedRate | null;
  problems: string[];
  explanation: string;
}

export interface CostItemLine {
  id: string;
  kind: string;
  description: string;
  quantity: string;
  unitCost: string | null;
  currency: string;
  /** Сумма в исходной валюте; null — неизвестна. */
  amountOriginal: string | null;
  /** Сумма в валюте КП; null — неизвестна или нет курса. */
  amount: string | null;
  rate: AppliedRate | null;
  /** standalone — наценяется вместе с услугами; linked — себестоимость строки спецификации. */
  state: 'standalone' | 'linked' | 'orphan';
  specItemRef: string | null;
  problems: string[];
  explanation: string;
}

export interface SupplyBreakdown {
  currency: string;
  specificationVersion: number | null;
  lines: SupplyLine[];
  costItems: CostItemLine[];
  /** Известная часть, округлено до 2 знаков. */
  supplyPrice: number;
  supplyCost: number;
  supplyVat: number;
  /** Статьи без связи со спецификацией: входят в себестоимость перед наценкой. */
  costItemsCost: number;
  incomplete: boolean;
  problems: string[];
  explanation: string[];
}

const SCALE = BigInt(10) ** BigInt(12);
const ZERO = BigInt(0);
const TWO = BigInt(2);

function divRound(n: bigint, d: bigint): bigint {
  const neg = n < ZERO;
  const abs = neg ? -n : n;
  const q = (abs + d / TWO) / d;
  return neg ? -q : q;
}

/** Точное (до 10^-12) произведение десятичных строк. */
export function mulDecimal(a: string, b: string): string {
  return fromScaled(divRound(toScaled(a) * toScaled(b), SCALE));
}

export function addDecimal(a: string, b: string): string {
  return fromScaled(toScaled(a) + toScaled(b));
}

/** (100 − p) / 100 как точная десятичная строка. */
function remainingShare(percent: string): string {
  return fromScaled(divRound((toScaled('100') - toScaled(percent)) * SCALE, toScaled('100')));
}

function percentOf(amount: string, percent: string): string {
  return fromScaled(divRound(toScaled(amount) * toScaled(percent), toScaled('100')));
}

const toNumber = (v: string) => Number(roundDecimal(v, 2));

function vatPercentString(n: number): string {
  const s = String(Math.round(n * 1_000_000) / 1_000_000);
  return /e/i.test(s) ? n.toFixed(6) : s;
}

/** Поставка, статьи затрат и их сумма в валюте КП с пояснением по каждой строке. */
export function buildSupply(input: SupplyInput): SupplyBreakdown {
  const target = input.currency;
  const defaultVat = vatPercentString(input.vatPercent);
  const rates = new Map(
    (input.specification?.exchangeRates ?? [])
      .filter((r) => r.to === target)
      .map((r) => [r.from, r] as const),
  );
  const supplyItems = (input.specification?.items ?? []).filter(
    (i) => i.disposition === 'supply' && !isBundleComponent(i),
  );
  const supplyIds = new Set(supplyItems.map((i) => i.id));
  // Компоненты комплекта (правило 3a спецификации): цена и себестоимость — у строки-комплекта.
  const componentIds = new Set(
    (input.specification?.items ?? []).filter(isBundleComponent).map((i) => i.id),
  );

  // Статьи затрат: пересчёт и классификация.
  const costItems: CostItemLine[] = [...input.costItems]
    .sort((a, b) => a.order - b.order)
    .map((c) => {
      const problems: string[] = [];
      const amountOriginal = c.unitCost === null ? null : mulDecimal(c.quantity, c.unitCost);
      if (amountOriginal === null) problems.push('стоимость неизвестна');
      let amount: string | null = null;
      let rate: AppliedRate | null = null;
      if (amountOriginal !== null) {
        if (c.currency === target) amount = amountOriginal;
        else if (c.exchangeRate) {
          rate = {
            rate: c.exchangeRate,
            date: c.exchangeRateDate ?? '',
            source: c.exchangeRateSource ?? '',
          };
          amount = mulDecimal(amountOriginal, c.exchangeRate);
        } else problems.push(`нет курса ${c.currency}→${target}`);
      }
      const state: CostItemLine['state'] = !c.specItemRef
        ? 'standalone'
        : supplyIds.has(c.specItemRef)
          ? 'linked'
          : 'orphan';
      if (state === 'orphan') {
        problems.push(
          !input.specification
            ? 'спецификация не закреплена — связанная строка не найдена'
            : componentIds.has(c.specItemRef ?? '')
              ? 'строка — компонент комплекта: свяжите статью со строкой-комплектом'
              : 'связанная строка не входит в поставку закреплённой спецификации',
        );
      }
      const conv = rate ? ` × курс ${rate.rate} (${rate.date}, ${rate.source})` : '';
      const explanation =
        amountOriginal === null
          ? `${c.description}: стоимость неизвестна`
          : `${c.description}: ${c.quantity} × ${c.unitCost} ${c.currency}${conv} = ${amount ?? '—'} ${amount === null ? '' : target}`.trim();
      return {
        id: c.id,
        kind: c.kind,
        description: c.description,
        quantity: c.quantity,
        unitCost: c.unitCost,
        currency: c.currency,
        amountOriginal,
        amount,
        rate,
        state,
        specItemRef: c.specItemRef,
        problems,
        explanation,
      };
    });

  const lines: SupplyLine[] = supplyItems.map((item) => {
    const problems: string[] = [];
    const unitSale = item.salePrice ?? item.unitPrice;
    const discount = item.discountPercent ?? null;
    let saleOriginal: string | null = null;
    if (item.quantity === null || unitSale === null || !item.currency) {
      problems.push('цена неизвестна');
    } else {
      const gross = mulDecimal(item.quantity, unitSale);
      saleOriginal = discount ? mulDecimal(gross, remainingShare(discount)) : gross;
    }
    let rate: AppliedRate | null = null;
    const convert = (amount: string | null): string | null => {
      if (amount === null) return null;
      if (item.currency === target) return amount;
      const r = rates.get(item.currency);
      if (!r) return null;
      rate = { rate: r.rate, date: r.date, source: r.source };
      return mulDecimal(amount, r.rate);
    };
    const needsRate = Boolean(item.currency) && item.currency !== target;
    if (needsRate && !rates.has(item.currency)) {
      problems.push(`нет курса ${item.currency}→${target} в снимке спецификации`);
    }
    const sale = convert(saleOriginal);

    const linked = costItems.filter((c) => c.state === 'linked' && c.specItemRef === item.id);
    let cost: string | null = null;
    let costSource: SupplyLine['costSource'] = null;
    if (linked.length) {
      costSource = 'cost_items';
      cost = linked.every((c) => c.amount !== null)
        ? linked.reduce((acc, c) => addDecimal(acc, c.amount as string), '0')
        : null;
      if (cost === null) problems.push('себестоимость: у связанной статьи нет суммы или курса');
    } else if (item.purchasePrice !== undefined && item.quantity !== null) {
      costSource = 'purchase';
      cost = item.currency ? convert(mulDecimal(item.quantity, item.purchasePrice)) : null;
      if (cost === null && !needsRate) problems.push('себестоимость неизвестна');
    } else {
      problems.push('себестоимость неизвестна: нет цены закупки и связанной статьи');
    }
    const vatPercent = item.vatRate ?? defaultVat;
    const vat = !input.includeVat ? '0' : sale === null ? null : percentOf(sale, vatPercent);

    const parts = [
      `${item.quantity ?? '?'} × ${unitSale ?? '?'} ${item.currency || '?'}`,
      discount ? ` × (1 − ${discount}%)` : '',
      rate
        ? ` × курс ${(rate as AppliedRate).rate} (${(rate as AppliedRate).date}, ${(rate as AppliedRate).source})`
        : '',
      ` = ${sale ?? 'неизвестно'}${sale === null ? '' : ` ${target}`}`,
      `; себестоимость ${cost ?? 'неизвестна'}${costSource === 'cost_items' ? ' (связанные статьи)' : costSource === 'purchase' ? ' (цена закупки)' : ''}`,
      input.includeVat ? `; НДС ${vatPercent}%` : '',
    ];
    return {
      ref: item.id,
      name: item.name || item.sku || item.id,
      kind: item.kind,
      quantity: item.quantity,
      currency: item.currency,
      unitSale,
      discountPercent: discount,
      saleOriginal,
      sale,
      cost,
      costSource,
      vatPercent,
      vat,
      rate,
      problems,
      explanation: `${item.name || item.id}: ${parts.join('')}`,
    };
  });

  const sum = (values: (string | null)[]) =>
    values.reduce<string>((acc, v) => (v === null ? acc : addDecimal(acc, v)), '0');
  const supplyPrice = toNumber(sum(lines.map((l) => l.sale)));
  const supplyCost = toNumber(sum(lines.map((l) => l.cost)));
  const supplyVat = toNumber(sum(lines.map((l) => l.vat)));
  const standalone = costItems.filter((c) => c.state === 'standalone');
  const costItemsCost = toNumber(sum(standalone.map((c) => c.amount)));

  const problems = [
    ...lines.flatMap((l) => l.problems.map((p) => `${l.name}: ${p}`)),
    ...costItems.flatMap((c) => c.problems.map((p) => `${c.description}: ${p}`)),
  ];
  const explanation = [
    input.specification
      ? `Поставка — подтверждённая спецификация v${input.specification.version}: ${lines.length} строк(и) к поставке, компоненты комплектов не суммируются.`
      : 'Спецификация в КП не закреплена: поставка не входит в цену.',
    `Цена поставки без НДС = Σ количество × цена продажи × (1 − скидка строки) = ${supplyPrice} ${target}; себестоимость поставки ${supplyCost} ${target}.`,
    `Статьи затрат без связи со спецификацией = ${costItemsCost} ${target}: входят в себестоимость перед наценкой/маржой, как труд.`,
    'Связанные со строкой спецификации статьи задают её себестоимость и не наценяются отдельно.',
    ...(problems.length ? [`Неполные данные (не считаются нулём): ${problems.join('; ')}.`] : []),
  ];
  return {
    currency: target,
    specificationVersion: input.specification?.version ?? null,
    lines,
    costItems,
    supplyPrice,
    supplyCost,
    supplyVat,
    costItemsCost,
    incomplete: problems.length > 0,
    problems,
    explanation,
  };
}
