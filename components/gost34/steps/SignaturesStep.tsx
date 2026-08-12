'use client';

import { REQUIRED_SIGNATURE_FIELDS } from '@/lib/gost34/wizard/compliance';
import { PANEL_CLASS } from '../wizardShared';

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
      <div key={key}>
        <label className="block text-slate-300 text-[11px] font-bold mb-1">{label} (ФИО)</label>
        <input
          type="text"
          value={signatures[key] ?? ''}
          onChange={(e) => onSignatureChange(key, e.target.value)}
          aria-invalid={isEmpty}
          className={`w-full bg-[#242832] border rounded-lg px-3 py-2 text-white focus:outline-none ${
            isEmpty
              ? 'border-red-500/60 focus:border-red-400'
              : 'border-[#434c5e] focus:border-blue-400'
          }`}
        />
        {isEmpty && (
          <span className="text-[10px] text-red-300 mt-1 block">
            Поле основной надписи обязательно
          </span>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-4 animate-in fade-in duration-150">
      <div className={`${PANEL_CLASS} space-y-4`}>
        <div>
          <h4 className="text-sm font-bold text-blue-400 uppercase tracking-wider">
            ✍️ Данные основной надписи (ГОСТ 2.104-2006, формы 2 и 2а)
          </h4>
          <p className="text-xs text-slate-300 mt-1">
            Заполните ФИО должностных лиц для вывода в штампах нормоконтроля документа
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="bg-[#1c1f26] p-4 rounded-xl border border-[#3b4252] space-y-3">
            <span className="text-xs font-bold text-white uppercase tracking-wider block border-b border-[#3b4252] pb-2">
              Согласующие от Исполнителя
            </span>
            <div className="space-y-3 text-xs">
              {REQUIRED_SIGNATURE_FIELDS.filter((item) => EXECUTOR_FIELDS.includes(item.key)).map(
                (item) => field(item.key, item.label),
              )}
            </div>
          </div>

          <div className="bg-[#1c1f26] p-4 rounded-xl border border-[#3b4252] space-y-3">
            <span className="text-xs font-bold text-white uppercase tracking-wider block border-b border-[#3b4252] pb-2">
              Согласующие от Заказчика и реквизиты
            </span>
            <div className="space-y-3 text-xs">
              {REQUIRED_SIGNATURE_FIELDS.filter((item) => !EXECUTOR_FIELDS.includes(item.key)).map(
                (item) => field(item.key, item.label),
              )}

              <div>
                <label className="block text-slate-300 text-[11px] font-bold mb-1">
                  Номер договора / шифр проекта
                </label>
                <input
                  type="text"
                  value={contractNumber}
                  onChange={(e) => onContractNumberChange(e.target.value)}
                  className="w-full bg-[#242832] border border-[#434c5e] rounded-lg px-3 py-2 text-white focus:border-blue-400 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-slate-300 text-[11px] font-bold mb-1">
                  Город издания документа
                </label>
                <input
                  type="text"
                  value={city}
                  onChange={(e) => onCityChange(e.target.value)}
                  className="w-full bg-[#242832] border border-[#434c5e] rounded-lg px-3 py-2 text-white focus:border-blue-400 focus:outline-none"
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
