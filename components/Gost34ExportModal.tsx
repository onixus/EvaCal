"use client";

import { useState } from "react";

interface Gost34ExportModalProps {
  calculationId: string;
  calculationName?: string;
  customerName?: string;
  isOpen: boolean;
  onClose: () => void;
}

export default function Gost34ExportModal({
  calculationId,
  calculationName = "Проект",
  customerName = "Заказчик",
  isOpen,
  onClose,
}: Gost34ExportModalProps) {
  const [docType, setDocType] = useState<"TZ" | "PZ" | "AF" | "PMI">("TZ");
  const [approverCustomerRole, setApproverCustomerRole] = useState("Директор по ИТ");
  const [approverCustomerName, setApproverCustomerName] = useState("И.И. Иванов");
  const [approverDevRole, setApproverDevRole] = useState("Технический директор");
  const [approverDevName, setApproverDevName] = useState("П.П. Петров");
  const [contractNumber, setContractNumber] = useState("Договор № 01-ГС/2026");
  const [city, setCity] = useState("Москва");
  const [enrich, setEnrich] = useState(true);

  if (!isOpen) return null;

  const handleDownload = () => {
    const params = new URLSearchParams({
      docType,
      approverCustomerRole,
      approverCustomerName,
      approverDevRole,
      approverDevName,
      contractNumber,
      city,
      enrich: String(enrich),
    });

    const url = `/api/calculations/${calculationId}/gost34?${params.toString()}`;
    window.open(url, "_blank");
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="w-full max-w-2xl rounded-xl bg-nord-nord1 dark:bg-nord-nord1 border border-nord-nord3 p-6 text-nord-nord6 shadow-2xl animate-in fade-in zoom-in-95 duration-150">
        <div className="flex items-center justify-between border-b border-nord-nord3 pb-3 mb-4">
          <div>
            <h3 className="text-lg font-bold text-nord-accent">Экспорт документации по ГОСТ 34 РФ</h3>
            <p className="text-xs text-nord-muted">Настройка типа документа и согласовывающих реквизитов</p>
          </div>
          <button
            onClick={onClose}
            className="text-nord-muted hover:text-nord-nord6 text-xl font-bold p-1 rounded transition-colors"
          >
            ✕
          </button>
        </div>

        <div className="space-y-4 text-sm max-h-[70vh] overflow-y-auto pr-1">
          {/* Document Type Selector */}
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-nord-muted mb-2">
              Тип документа ГОСТ 34 / РД 50-34.698-90
            </label>
            <div className="grid grid-cols-2 gap-2">
              {[
                { type: "TZ", label: "ТЗ (ГОСТ 34.602-89)", desc: "Техническое задание" },
                { type: "PZ", label: "ПЗ (РД 50-34.698-90 п.2.1)", desc: "Пояснительная записка" },
                { type: "AF", label: "АФ (РД 50-34.698-90 п.2.2)", desc: "Описание функций" },
                { type: "PMI", label: "ПМИ (РД 50-34.698-90 п.2.7)", desc: "Программа и методика испытаний" },
              ].map((item) => (
                <button
                  key={item.type}
                  type="button"
                  onClick={() => setDocType(item.type as any)}
                  className={`p-3 rounded-lg border text-left transition-all ${
                    docType === item.type
                      ? "border-nord-accent bg-nord-accent/10 text-nord-nord6 shadow"
                      : "border-nord-nord3 bg-nord-nord0/40 text-nord-muted hover:border-nord-nord4"
                  }`}
                >
                  <div className="font-bold text-sm">{item.label}</div>
                  <div className="text-xs opacity-80">{item.desc}</div>
                </button>
              ))}
            </div>
          </div>

          {/* Requisites: Customer & Developer */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2 bg-nord-nord0/40 p-3 rounded-lg border border-nord-nord3">
              <span className="text-xs font-bold text-nord-accent uppercase">Утверждение (Заказчик)</span>
              <div>
                <label className="block text-xs text-nord-muted">Должность</label>
                <input
                  type="text"
                  value={approverCustomerRole}
                  onChange={(e) => setApproverCustomerRole(e.target.value)}
                  className="w-full mt-1 bg-nord-nord0 border border-nord-nord3 rounded px-2.5 py-1 text-sm focus:border-nord-accent focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-xs text-nord-muted">ФИО</label>
                <input
                  type="text"
                  value={approverCustomerName}
                  onChange={(e) => setApproverCustomerName(e.target.value)}
                  className="w-full mt-1 bg-nord-nord0 border border-nord-nord3 rounded px-2.5 py-1 text-sm focus:border-nord-accent focus:outline-none"
                />
              </div>
            </div>

            <div className="space-y-2 bg-nord-nord0/40 p-3 rounded-lg border border-nord-nord3">
              <span className="text-xs font-bold text-nord-accent uppercase">Согласование (Разработчик)</span>
              <div>
                <label className="block text-xs text-nord-muted">Должность</label>
                <input
                  type="text"
                  value={approverDevRole}
                  onChange={(e) => setApproverDevRole(e.target.value)}
                  className="w-full mt-1 bg-nord-nord0 border border-nord-nord3 rounded px-2.5 py-1 text-sm focus:border-nord-accent focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-xs text-nord-muted">ФИО</label>
                <input
                  type="text"
                  value={approverDevName}
                  onChange={(e) => setApproverDevName(e.target.value)}
                  className="w-full mt-1 bg-nord-nord0 border border-nord-nord3 rounded px-2.5 py-1 text-sm focus:border-nord-accent focus:outline-none"
                />
              </div>
            </div>
          </div>

          {/* Contract & City */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-nord-muted">Основание / Номер договора</label>
              <input
                type="text"
                value={contractNumber}
                onChange={(e) => setContractNumber(e.target.value)}
                className="w-full mt-1 bg-nord-nord0 border border-nord-nord3 rounded px-2.5 py-1 text-sm focus:border-nord-accent focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-xs text-nord-muted">Город издания</label>
              <input
                type="text"
                value={city}
                onChange={(e) => setCity(e.target.value)}
                className="w-full mt-1 bg-nord-nord0 border border-nord-nord3 rounded px-2.5 py-1 text-sm focus:border-nord-accent focus:outline-none"
              />
            </div>
          </div>

          {/* Regulatory Enrichment Toggle */}
          <div className="flex items-center gap-3 bg-nord-nord0/40 p-3 rounded-lg border border-nord-nord3">
            <input
              type="checkbox"
              id="enrichCheckbox"
              checked={enrich}
              onChange={(e) => setEnrich(e.target.checked)}
              className="w-4 h-4 accent-nord-accent rounded cursor-pointer"
            />
            <label htmlFor="enrichCheckbox" className="text-xs cursor-pointer">
              <span className="font-bold text-nord-nord6 block">Нормативное авто-обогащение требований ГОСТ</span>
              <span className="text-nord-muted block">
                Приказы ФСТЭК России № 21 и № 117 (ИСПДн / безопасная разработка по ГОСТ Р 56939-2016), 152-ФЗ, 99.9% uptime (RTO/RPO) и WCAG 2.1
              </span>
            </label>
          </div>
        </div>

        {/* Modal Actions */}
        <div className="flex items-center justify-end gap-3 border-t border-nord-nord3 pt-4 mt-6">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-lg text-sm bg-nord-nord3 text-nord-nord6 hover:bg-nord-nord4 transition-colors"
          >
            Отмена
          </button>
          <button
            type="button"
            onClick={handleDownload}
            className="px-5 py-2 rounded-lg text-sm font-semibold bg-nord-accent text-white hover:bg-nord-accent/90 shadow-lg shadow-nord-accent/20 transition-all flex items-center gap-2"
          >
            <span>Скачать документ (.docx)</span>
          </button>
        </div>
      </div>
    </div>
  );
}
