import { requireRole } from '@/lib/auth';
import ExchangeRatesAdmin from '@/components/ExchangeRatesAdmin';
import { EXCHANGE_RATE_EDIT_ROLES } from '@/lib/commercialContourHttp';

export const dynamic = 'force-dynamic';

/** Справочник курсов валют (#101 §3): ведут архитектор и администратор. */
export default async function ExchangeRatesPage() {
  await requireRole(EXCHANGE_RATE_EDIT_ROLES, '/catalog/exchange-rates');
  return (
    <div className="page">
      <h1 className="text-xl font-bold">Курсы валют</h1>
      <p className="text-sm text-slate-500 dark:text-nord-muted">
        Пересчёт цен спецификации и статей затрат в валюту КП выполняется только по курсу,
        сохранённому с датой и источником. Исходные цены и валюты не меняются.
      </p>
      <ExchangeRatesAdmin canEdit />
    </div>
  );
}
