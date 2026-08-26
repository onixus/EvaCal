'use client';

import { REQUIRED_SIGNATURE_FIELDS } from '@/lib/gost34/wizard/compliance';
import { PANEL_CLASS, fieldAnchorId } from '../wizardShared';

const EXECUTOR_FIELDS = ['developer', 'checker', 'normControl', 'approver'];

interface SignaturesStepProps {
  signatures: Record<string, string>;
  onSignatureChange: (key: string, value: string) => void;
  contractNumber: string;
  onContractNumberChange: (value: string) => void;
  city: string;
  onCityChange: (value: string) => void;
}

export default function SignaturesStep({
  signatures,
  onSignatureChange,
  contractNumber,
  onContractNumberChange,
  city,
  onCityChange,
}: SignaturesStepProps) {
  const field = (key: string, label: string) => {
    const isEmpty = !String(signatures[key] ?? '').trim();

    return (
      // id совпадает с fieldRef замечания («signatures.approver»): по нему
      // панель блокеров находит поле и подсвечивает его.
      <div key={key} id={fieldAnchorId(`signatures.${key}`)}>
        <label className="label">{label} (ФИО)</label>
        <input
          type="text"
          value={signatures[key] ?? ''}
          onChange={(e) => onSignatureChange(key, e.target.value)}
          aria-invalid={isEmpty}
          placeholder="ФИО"
          className={`input ${isEmpty ? 'input-error' : ''}`}
        />
        {isEmpty && (
          <span className="mt-1 block text-[10px] font-semibold text-rose-600 dark:text-nord-redText">
            Обязательное поле основной надписи — блокирует выпуск
          </span>
        )}
      </div>
    );
  };

  return (
    <div className="animate-in fade-in space-y-4 duration-150">
      <div className={`${PANEL_CLASS} space-y-4`}>
        <div>
          <h3 className="text-sm font-bold text-slate-900 dark:text-nord-6">Реквизиты и подписи</h3>
          <p className="mt-1 text-xs leading-relaxed text-slate-500 dark:text-nord-muted">
            Основная надпись по ГОСТ 2.104-2006 (формы 2 и 2а). Пустые обязательные поля блокируют
            выпуск.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="space-y-3 rounded-lg border border-slate-200 bg-slate-50/60 p-3.5 dark:border-nord-3 dark:bg-nord-1/50">
            <span className="block border-b border-slate-200 pb-2 text-[11px] font-bold uppercase tracking-wider text-slate-600 dark:border-nord-3 dark:text-nord-4">
              От Исполнителя
            </span>
            <div className="space-y-3">
              {REQUIRED_SIGNATURE_FIELDS.filter((item) => EXECUTOR_FIELDS.includes(item.key)).map(
                (item) => field(item.key, item.label),
              )}
            </div>
          </div>

          <div className="space-y-3 rounded-lg border border-slate-200 bg-slate-50/60 p-3.5 dark:border-nord-3 dark:bg-nord-1/50">
            <span className="block border-b border-slate-200 pb-2 text-[11px] font-bold uppercase tracking-wider text-slate-600 dark:border-nord-3 dark:text-nord-4">
              От Заказчика и реквизиты
            </span>
            <div className="space-y-3">
              {REQUIRED_SIGNATURE_FIELDS.filter((item) => !EXECUTOR_FIELDS.includes(item.key)).map(
                (item) => field(item.key, item.label),
              )}

              <div>
                <label className="label">Номер договора / шифр проекта</label>
                <input
                  type="text"
                  value={contractNumber}
                  onChange={(e) => onContractNumberChange(e.target.value)}
                  className="input"
                />
              </div>

              <div>
                <label className="label">Город издания документа</label>
                <input
                  type="text"
                  value={city}
                  onChange={(e) => onCityChange(e.target.value)}
                  className="input"
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
