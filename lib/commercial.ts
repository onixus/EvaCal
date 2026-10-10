import { ROLES, roleLabel } from './roles';
import { totalLaborHours } from './scheduling';
import { risksTotalHours } from './totals';

export const DEFAULT_ROLE_RATES: Record<string, number> = {
  architect: 5500,
  consultant: 4500,
  analyst: 4000,
  developer: 3500,
  engineer: 3500,
  pm: 4500,
  customer: 0,
  other: 3000,
};

export interface CurrencyConfig {
  code: string;
  symbol: string;
  label: string;
}

export const SUPPORTED_CURRENCIES: Record<string, CurrencyConfig> = {
  RUB: { code: 'RUB', symbol: '₽', label: 'Российский рубль (₽)' },
  USD: { code: 'USD', symbol: '$', label: 'Доллар США ($)' },
  EUR: { code: 'EUR', symbol: '€', label: 'Евро (€)' },
  CNY: { code: 'CNY', symbol: '¥', label: 'Китайский юань (¥)' },
  KZT: { code: 'KZT', symbol: '₸', label: 'Казахстанский тенге (₸)' },
  BYN: { code: 'BYN', symbol: 'Br', label: 'Белорусский рубль (Br)' },
};

export function formatCurrency(
  amount: number,
  currencyCode: string = 'RUB',
  options: { decimals?: number } = {},
): string {
  const { decimals = 0 } = options;
  const currency = SUPPORTED_CURRENCIES[currencyCode] || SUPPORTED_CURRENCIES.RUB;

  const formattedNum = new Intl.NumberFormat('ru-RU', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(amount);

  return `${formattedNum} ${currency.symbol}`;
}

export interface RoleCommercialBreakdown {
  role: string;
  roleLabel: string;
  hours: number;
  rate: number;
  cost: number;
  sharePercent: number;
}

export interface CommercialConfig {
  pricingMode?: string;
  currency?: string;
  roleRates?: Record<string, number> | string | null;
  overheadPercent?: number;
  marginPercent?: number;
  discountPercent?: number;
  vatPercent?: number;
  includeVat?: boolean;
}

export interface CommercialSummary {
  pricingMode: PricingMode;
  profitAfterDiscount: number;
  effectiveMarginPercent: number | null;
  currency: string;
  currencySymbol: string;
  rolesBreakdown: RoleCommercialBreakdown[];
  stagesHours: number;
  stagesCost: number;
  pmHours: number;
  pmRate: number;
  pmCost: number;
  riskHours: number;
  riskCost: number;
  directLaborHours: number;
  directLaborCost: number;
  overheadPercent: number;
  overheadAmount: number;
  totalCost: number; // Labor + Overhead
  marginPercent: number;
  marginAmount: number;
  priceBeforeDiscount: number;
  discountPercent: number;
  discountAmount: number;
  subtotalExVat: number;
  vatPercent: number;
  vatAmount: number;
  grandTotal: number;
  blendedHourlyRate: number; // Effective rate per hour (subtotal / directLaborHours)
}

export type PricingMode = 'legacy_markup' | 'markup' | 'target_margin';
export const PRICING_MODE_LABELS: Record<PricingMode, string> = {
  legacy_markup: 'Наценка на себестоимость (прежние правила)',
  markup: 'Наценка на себестоимость',
  target_margin: 'Целевая маржа от выручки',
};

export function resolvePricingMode(value?: string): PricingMode {
  if (value === undefined) return 'legacy_markup';
  if (value === 'legacy_markup' || value === 'markup' || value === 'target_margin') return value;
  throw new Error('Неизвестный режим расчета цены');
}

/** Validate writes before touching the calculation or regenerating stages. */
export function validateCommercialUpdate(
  body: Record<string, unknown>,
  existing: { pricingMode?: string; marginPercent: number },
): void {
  const mode = resolvePricingMode(
    body.pricingMode === undefined ? existing.pricingMode : String(body.pricingMode),
  );
  for (const key of ['marginPercent', 'overheadPercent', 'discountPercent', 'vatPercent']) {
    const value = body[key];
    if (value === undefined) continue;
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
      throw new Error(`${key}: требуется конечное неотрицательное число`);
    }
    if ((key === 'discountPercent' || key === 'vatPercent') && value > 100) {
      throw new Error(`${key}: значение должно быть не больше 100%`);
    }
  }
  const percent = body.marginPercent === undefined ? existing.marginPercent : body.marginPercent;
  if (
    mode === 'target_margin' &&
    (typeof percent !== 'number' || percent >= 100 || percent < 0 || !Number.isFinite(percent))
  ) {
    throw new Error('Целевая маржа должна быть от 0% включительно до 100% исключительно');
  }
  if (body.includeVat !== undefined && typeof body.includeVat !== 'boolean') {
    throw new Error('includeVat: требуется логическое значение');
  }
  if (body.roleRates !== undefined) {
    let rates = body.roleRates;
    if (typeof rates === 'string') {
      try {
        rates = JSON.parse(rates);
      } catch {
        throw new Error('Некорректный JSON ставок');
      }
    }
    if (rates !== null && (typeof rates !== 'object' || Array.isArray(rates))) {
      throw new Error('Ставки должны быть объектом');
    }
    for (const value of Object.values(rates ?? {})) {
      if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
        throw new Error('Ставки должны быть конечными неотрицательными числами');
      }
    }
  }
}

/**
 * Parses role rates from DB string or object with fallback to default rates.
 */
export function resolveRoleRates(
  rawRates?: Record<string, number> | string | null,
): Record<string, number> {
  let parsed: Record<string, number> = {};
  if (typeof rawRates === 'string') {
    try {
      parsed = JSON.parse(rawRates);
    } catch {
      parsed = {};
    }
  } else if (typeof rawRates === 'object' && rawRates !== null) {
    parsed = rawRates;
  }

  return {
    ...DEFAULT_ROLE_RATES,
    ...parsed,
  };
}

function safePercent(val: unknown, fallback: number): number {
  if (val === undefined || val === null) return fallback;
  const num = typeof val === 'number' ? val : Number(val);
  return Number.isFinite(num) && num >= 0 ? num : fallback;
}

/**
 * Calculates complete financial and commercial metrics for a calculation.
 */
export function calculateCommercialSummary(
  stages: { hours: number; role?: string; isApprovalTask?: boolean }[],
  pmHours: number,
  risks: { hours: number }[],
  config: CommercialConfig = {},
): CommercialSummary {
  const currency = config.currency || 'RUB';
  const currencySymbol = SUPPORTED_CURRENCIES[currency]?.symbol || '₽';
  const roleRates = resolveRoleRates(config.roleRates);
  const overheadPercent = safePercent(config.overheadPercent, 0);
  const marginPercent = safePercent(config.marginPercent, 20);
  const discountPercent = safePercent(config.discountPercent, 0);
  const vatPercent = safePercent(config.vatPercent, 20);
  const includeVat = config.includeVat ?? true;
  const pricingMode = resolvePricingMode(config.pricingMode);
  if (pricingMode === 'target_margin') {
    validateCommercialUpdate(
      { marginPercent: config.marginPercent ?? 20 },
      { pricingMode, marginPercent },
    );
  }
  // Released legacy calculations keep their original whole-unit rounding.
  const money =
    pricingMode === 'legacy_markup'
      ? Math.round
      : (value: number) =>
          Math.round((value + Number.EPSILON * Math.max(1, Math.abs(value))) * 100) / 100;

  // 1. Group stages by role
  const roleHoursMap: Record<string, number> = {};
  for (const r of ROLES) {
    roleHoursMap[r.value] = 0;
  }

  for (const stage of stages) {
    if (stage.isApprovalTask) continue;
    const roleKey = stage.role && roleRates[stage.role] !== undefined ? stage.role : 'other';
    roleHoursMap[roleKey] = (roleHoursMap[roleKey] || 0) + stage.hours;
  }

  // 2. Compute cost per role
  const rolesBreakdown: RoleCommercialBreakdown[] = [];
  let stagesHours = 0;
  let stagesCost = 0;

  for (const roleKey of Object.keys(roleHoursMap)) {
    const hours = roleHoursMap[roleKey];
    if (hours <= 0 && roleKey === 'customer') continue;
    const rate = roleRates[roleKey] ?? DEFAULT_ROLE_RATES.other ?? 3000;
    const cost = pricingMode === 'legacy_markup' ? hours * rate : money(hours * rate);

    stagesHours += hours;
    stagesCost += cost;

    if (hours > 0) {
      rolesBreakdown.push({
        role: roleKey,
        roleLabel: roleLabel(roleKey),
        hours,
        rate,
        cost,
        sharePercent: 0, // will compute after direct cost
      });
    }
  }

  // 3. PM (Project Management)
  const pmRate = roleRates.pm ?? DEFAULT_ROLE_RATES.pm ?? 4500;
  const pmCost = pricingMode === 'legacy_markup' ? pmHours * pmRate : money(pmHours * pmRate);

  // 4. Risks
  const riskHours = risksTotalHours(risks);
  const directHoursExRisk = stagesHours + pmHours;
  const directCostExRisk = stagesCost + pmCost;
  const baseBlendedRate =
    directHoursExRisk > 0 ? directCostExRisk / directHoursExRisk : (roleRates.developer ?? 3500);
  const riskCost =
    pricingMode === 'legacy_markup'
      ? riskHours * baseBlendedRate
      : money(riskHours * baseBlendedRate);

  // 5. Total Labor
  const directLaborHours = directHoursExRisk + riskHours;
  const directLaborCost =
    pricingMode === 'legacy_markup'
      ? directCostExRisk + riskCost
      : money(directCostExRisk + riskCost);

  // Compute share percentages
  for (const item of rolesBreakdown) {
    item.sharePercent = directLaborCost > 0 ? Math.round((item.cost / directLaborCost) * 100) : 0;
  }

  // 6. Overheads
  const overheadAmount = money(directLaborCost * (overheadPercent / 100));
  const totalCost =
    pricingMode === 'legacy_markup'
      ? directLaborCost + overheadAmount
      : money(directLaborCost + overheadAmount);

  // 7. Margin / Target Price
  const priceBeforeDiscount =
    pricingMode === 'target_margin'
      ? money(totalCost / (1 - marginPercent / 100))
      : pricingMode === 'legacy_markup'
        ? totalCost + money(totalCost * (marginPercent / 100))
        : money(totalCost + money(totalCost * (marginPercent / 100)));
  const marginAmount =
    pricingMode === 'legacy_markup'
      ? Math.round(totalCost * (marginPercent / 100))
      : money(priceBeforeDiscount - totalCost);

  // 8. Discount
  const discountAmount = money(priceBeforeDiscount * (discountPercent / 100));
  const subtotalExVat = Math.max(
    0,
    pricingMode === 'legacy_markup'
      ? priceBeforeDiscount - discountAmount
      : money(priceBeforeDiscount - discountAmount),
  );
  const profitAfterDiscount =
    pricingMode === 'legacy_markup' ? subtotalExVat - totalCost : money(subtotalExVat - totalCost);
  const effectiveMarginPercent =
    subtotalExVat > 0 ? (profitAfterDiscount / subtotalExVat) * 100 : null;

  // 9. VAT
  const vatAmount = includeVat ? money(subtotalExVat * (vatPercent / 100)) : 0;
  const grandTotal =
    pricingMode === 'legacy_markup' ? subtotalExVat + vatAmount : money(subtotalExVat + vatAmount);

  // 10. Effective blended rate per hour
  const blendedHourlyRate = directLaborHours > 0 ? money(subtotalExVat / directLaborHours) : 0;

  return {
    pricingMode,
    profitAfterDiscount,
    effectiveMarginPercent,
    currency,
    currencySymbol,
    rolesBreakdown,
    stagesHours,
    stagesCost,
    pmHours,
    pmRate,
    pmCost,
    riskHours,
    riskCost,
    directLaborHours,
    directLaborCost,
    overheadPercent,
    overheadAmount,
    totalCost,
    marginPercent,
    marginAmount,
    priceBeforeDiscount,
    discountPercent,
    discountAmount,
    subtotalExVat,
    vatPercent,
    vatAmount,
    grandTotal,
    blendedHourlyRate,
  };
}
