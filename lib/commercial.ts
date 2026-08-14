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
  currency?: string;
  roleRates?: Record<string, number> | string | null;
  overheadPercent?: number;
  marginPercent?: number;
  discountPercent?: number;
  vatPercent?: number;
  includeVat?: boolean;
}

export interface CommercialSummary {
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
  const overheadPercent = Math.max(0, config.overheadPercent ?? 0);
  const marginPercent = Math.max(0, config.marginPercent ?? 20);
  const discountPercent = Math.max(0, config.discountPercent ?? 0);
  const vatPercent = Math.max(0, config.vatPercent ?? 20);
  const includeVat = config.includeVat ?? true;

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
    const cost = hours * rate;

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
  const pmCost = pmHours * pmRate;

  // 4. Risks
  const riskHours = risksTotalHours(risks);
  const directHoursExRisk = stagesHours + pmHours;
  const directCostExRisk = stagesCost + pmCost;
  const baseBlendedRate =
    directHoursExRisk > 0 ? directCostExRisk / directHoursExRisk : (roleRates.developer ?? 3500);
  const riskCost = riskHours * baseBlendedRate;

  // 5. Total Labor
  const directLaborHours = directHoursExRisk + riskHours;
  const directLaborCost = directCostExRisk + riskCost;

  // Compute share percentages
  for (const item of rolesBreakdown) {
    item.sharePercent =
      directLaborCost > 0 ? Math.round((item.cost / directLaborCost) * 100) : 0;
  }

  // 6. Overheads
  const overheadAmount = Math.round(directLaborCost * (overheadPercent / 100));
  const totalCost = directLaborCost + overheadAmount;

  // 7. Margin / Target Price
  // Margin as markup on cost: TotalCost * (1 + margin%)
  const marginAmount = Math.round(totalCost * (marginPercent / 100));
  const priceBeforeDiscount = totalCost + marginAmount;

  // 8. Discount
  const discountAmount = Math.round(priceBeforeDiscount * (discountPercent / 100));
  const subtotalExVat = Math.max(0, priceBeforeDiscount - discountAmount);

  // 9. VAT
  const vatAmount = includeVat ? Math.round(subtotalExVat * (vatPercent / 100)) : 0;
  const grandTotal = subtotalExVat + vatAmount;

  // 10. Effective blended rate per hour
  const blendedHourlyRate =
    directLaborHours > 0 ? Math.round(subtotalExVat / directLaborHours) : 0;

  return {
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
