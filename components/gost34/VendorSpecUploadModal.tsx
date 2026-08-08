"use client";

import { useState, useEffect } from "react";
import { GostDocumentType, Gost34RequirementItem } from "@/lib/gost34/types";
import { normalizeRequirementItems } from "@/lib/gost34/parser/requirementSanitizer";
import { DEFAULT_GOST34_PROFILE } from "@/lib/gost34/standards";
import { ENRICHMENT_OPTION_KEYS } from "@/lib/gost34/enricher";

/**
 * The modal exports under the default (legacy) profile. The current profile is
 * reachable only through the API until its TZ structure lands (PR-03).
 */
const EXPORT_PROFILE = DEFAULT_GOST34_PROFILE;

const DOCUMENT_TYPE_CARDS: Array<{ type: GostDocumentType; title: string; gost: string; desc: string }> =
  [...EXPORT_PROFILE.documentTypes]
    .sort((a, b) => a.zipOrder - b.zipOrder)
    .map((doc) => ({
      type: doc.docType,
      title: doc.uiTitle,
      gost: doc.standardCitation,
      desc: doc.uiDescription,
    }));

interface VendorSpecUploadModalProps {
  calculationId: string;
  calculationName?: string;
  customerName?: string;
  isOpen: boolean;
  onClose: () => void;
}

type TabType = "vendor" | "enrichment" | "signatures" | "export";

export default function VendorSpecUploadModal({
  calculationId,
  calculationName = "Проект",
  customerName = "Заказчик",
  isOpen,
  onClose,
}: VendorSpecUploadModalProps) {
  // Navigation tab state
  const [activeTab, setActiveTab] = useState<TabType>("vendor");

  // Document metadata state
  const [docType, setDocType] = useState<GostDocumentType>("TZ");
  const [developer, setDeveloper] = useState("Иванов А.В.");
  const [checker, setChecker] = useState("Петров С.Н.");
  const [normControl, setNormControl] = useState("Васильева Е.И.");
  const [approver, setApprover] = useState("Михайлов Д.П.");
  const [customerApprover, setCustomerApprover] = useState("Александров И.В.");
  const [contractNumber, setContractNumber] = useState("Договор № 01-ГС/2026");
  const [city, setCity] = useState("Москва");

  // Regulatory enrichment options state
  const [enrich, setEnrich] = useState(true);
  const [optFstek21, setOptFstek21] = useState(true);
  const [optFstek117, setOptFstek117] = useState(true);
  const [optFstek239, setOptFstek239] = useState(true);
  const [optGost57580, setOptGost57580] = useState(true);
  const [optCb683, setOptCb683] = useState(true);
  const [optCb757, setOptCb757] = useState(true);
  const [optCb719, setOptCb719] = useState(true);
  const [optFsb282, setOptFsb282] = useState(true);
  const [optFz187, setOptFz187] = useState(true);
  const [optFz152, setOptFz152] = useState(true);
  const [optFz188, setOptFz188] = useState(true);
  const [optSla, setOptSla] = useState(true);
  const [optWcag, setOptWcag] = useState(true);

  // Vendor file upload & requirement extraction state
  const [uploadedFiles, setUploadedFiles] = useState<string[]>([]);
  const [extractedReqs, setExtractedReqs] = useState<Gost34RequirementItem[]>([]);
  const [isParsing, setIsParsing] = useState(false);

  // Requirement manual entry form & category filter state
  const [newReqCode, setNewReqCode] = useState("");
  const [newReqTitle, setNewReqTitle] = useState("");
  const [newReqDesc, setNewReqDesc] = useState("");
  const [selectedCategoryFilter, setSelectedCategoryFilter] = useState<string>("all");

  // Local LLM / Ollama & LM Studio configuration state
  const [showLlmSettings, setShowLlmSettings] = useState<boolean>(false);
  const [llmProvider, setLlmProvider] = useState<"ollama" | "openai_compatible">("ollama");
  const [llmEndpoint, setLlmEndpoint] = useState<string>("http://localhost:11434");
  const [llmSelectedModel, setLlmSelectedModel] = useState<string>("");
  const [llmApiKey, setLlmApiKey] = useState<string>("");
  const [llmAvailable, setLlmAvailable] = useState<boolean>(false);
  const [llmModels, setLlmModels] = useState<string[]>([]);
  const [isLlmNormalizing, setIsLlmNormalizing] = useState<boolean>(false);

  // Load saved LLM settings from localStorage
  useEffect(() => {
    if (typeof window === "undefined") return;
    const savedProvider = localStorage.getItem("gost34_llm_provider") as any;
    const savedEndpoint = localStorage.getItem("gost34_llm_endpoint");
    const savedModel = localStorage.getItem("gost34_llm_model");
    const savedApiKey = localStorage.getItem("gost34_llm_apikey");

    if (savedProvider) setLlmProvider(savedProvider);
    if (savedEndpoint) setLlmEndpoint(savedEndpoint);
    if (savedModel) setLlmSelectedModel(savedModel);
    if (savedApiKey) setLlmApiKey(savedApiKey);
  }, []);

  const handleCheckLlmStatus = async (
    endpoint = llmEndpoint,
    provider = llmProvider
  ) => {
    try {
      const query = new URLSearchParams({ endpoint, provider });
      const res = await fetch(`/api/gost34/llm-status?${query.toString()}`);
      const data = await res.json();
      setLlmAvailable(Boolean(data.available));
      setLlmModels(data.models || []);
      if (data.models && data.models.length > 0 && !llmSelectedModel) {
        setLlmSelectedModel(data.models[0]);
      }
      return data.available;
    } catch {
      setLlmAvailable(false);
      return false;
    }
  };

  // Check LLM status on modal open or endpoint change
  useEffect(() => {
    if (!isOpen) return;
    handleCheckLlmStatus(llmEndpoint, llmProvider);
  }, [isOpen, llmEndpoint, llmProvider]);

  const saveLlmSettings = (
    provider: "ollama" | "openai_compatible",
    endpoint: string,
    model: string,
    key: string
  ) => {
    if (typeof window === "undefined") return;
    localStorage.setItem("gost34_llm_provider", provider);
    localStorage.setItem("gost34_llm_endpoint", endpoint);
    localStorage.setItem("gost34_llm_model", model);
    localStorage.setItem("gost34_llm_apikey", key);
  };

  const handleNormalizeAll = () => {
    setExtractedReqs((prev) => normalizeRequirementItems(prev));
  };

  const handleLlmNormalize = async () => {
    if (extractedReqs.length === 0) return;
    setIsLlmNormalizing(true);
    try {
      const res = await fetch("/api/gost34/normalize-llm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          requirements: extractedReqs,
          provider: llmProvider,
          endpoint: llmEndpoint,
          model: llmSelectedModel,
          apiKey: llmApiKey,
        }),
      });

      if (!res.ok) {
        throw new Error("Ошибка при обработке ИИ-моделью");
      }

      const data = await res.json();
      if (Array.isArray(data.requirements) && data.requirements.length > 0) {
        setExtractedReqs(data.requirements);
      }
    } catch (err: any) {
      alert(`Не удалось выполнить ИИ-нормализацию: ${err?.message || "Ошибка ИИ"}`);
    } finally {
      setIsLlmNormalizing(false);
    }
  };

  if (!isOpen) return null;

  const countActiveEnrichments = () => {
    if (!enrich) return 0;
    const flags = [
      optFstek21,
      optFstek117,
      optFstek239,
      optGost57580,
      optCb683,
      optCb757,
      optCb719,
      optFsb282,
      optFz187,
      optFz152,
      optFz188,
      optSla,
      optWcag,
    ];
    return flags.filter(Boolean).length;
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    setIsParsing(true);

    try {
      const formData = new FormData();
      for (let i = 0; i < files.length; i++) {
        formData.append("files", files[i]);
      }

      const res = await fetch("/api/gost34/parse-vendor-doc", {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        throw new Error("Ошибка при обработке документа");
      }

      const data = await res.json();
      const parsedFiles: string[] = data.parsedFiles || [];
      const newRequirements: Gost34RequirementItem[] = data.extractedRequirements || [];

      setUploadedFiles((prev) => [...prev, ...parsedFiles]);
      setExtractedReqs((prev) => [...prev, ...newRequirements]);
    } catch (err: any) {
      alert(`Не удалось распарсить файл: ${err?.message || "Ошибка сервера"}`);
    } finally {
      setIsParsing(false);
    }
  };

  const handleAddManualReq = () => {
    if (!newReqTitle.trim() || !newReqDesc.trim()) return;

    const newReq: Gost34RequirementItem = {
      id: `req-manual-${Date.now()}`,
      code: newReqCode.trim() || `ТР-ВЕНД-${String(extractedReqs.length + 1).padStart(2, "0")}`,
      category: "functional",
      title: newReqTitle.trim(),
      description: newReqDesc.trim(),
      sourceFile: "Ручной ввод",
    };

    setExtractedReqs((prev) => [...prev, newReq]);
    setNewReqCode("");
    setNewReqTitle("");
    setNewReqDesc("");
  };

  const handleDeleteReq = (id: string) => {
    setExtractedReqs((prev) => prev.filter((r) => r.id !== id));
  };

  const toggleAllEnrichments = (val: boolean) => {
    setOptFstek21(val);
    setOptFstek117(val);
    setOptFstek239(val);
    setOptGost57580(val);
    setOptCb683(val);
    setOptCb757(val);
    setOptCb719(val);
    setOptFsb282(val);
    setOptFz187(val);
    setOptFz152(val);
    setOptFz188(val);
    setOptSla(val);
    setOptWcag(val);
  };

  const handleDownload = async () => {
    try {
      const payload = {
        docType,
        contractNumber,
        city,
        enrich,
        enrichmentOptions: {
          fstek_21: optFstek21,
          fstek_117: optFstek117,
          fstek_239: optFstek239,
          gost_57580: optGost57580,
          cb_683p: optCb683,
          cb_757p: optCb757,
          cb_719p: optCb719,
          fsb_282_gossopka: optFsb282,
          fz_187_kii: optFz187,
          fz_152: optFz152,
          fz_188_reestr: optFz188,
          sla_999: optSla,
          wcag_52872: optWcag,
        },
        developer,
        checker,
        normControl,
        approver,
        customerApprover,
        rawRequirements: extractedReqs,
      };

      const res = await fetch(`/api/calculations/${calculationId}/gost34`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.error || "Ошибка при генерации документа ГОСТ 34");
      }

      const blob = await res.blob();
      const downloadUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = downloadUrl;
      a.download = `${docType}_GOST34_Document.docx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(downloadUrl);

      onClose();
    } catch (err: any) {
      alert(`Не удалось скачать документ: ${err?.message || "Ошибка сервера"}`);
    }
  };

  const handleDownloadZip = async () => {
    try {
      const payload = {
        docType: "ZIP",
        isBatchZip: true,
        contractNumber,
        city,
        enrich,
        enrichmentOptions: {
          fstek_21: optFstek21,
          fstek_117: optFstek117,
          fstek_239: optFstek239,
          gost_57580: optGost57580,
          cb_683p: optCb683,
          cb_757p: optCb757,
          cb_719p: optCb719,
          fsb_282_gossopka: optFsb282,
          fz_187_kii: optFz187,
          fz_152: optFz152,
          fz_188_reestr: optFz188,
          sla_999: optSla,
          wcag_52872: optWcag,
        },
        developer,
        checker,
        normControl,
        approver,
        customerApprover,
        rawRequirements: extractedReqs,
      };

      const res = await fetch(`/api/calculations/${calculationId}/gost34`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.error || "Ошибка при генерации ZIP комплекта ГОСТ 34");
      }

      const blob = await res.blob();
      const downloadUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = downloadUrl;
      a.download = `GOST34_Full_Package_${calculationName.replace(/\s+/g, '_')}.zip`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(downloadUrl);

      onClose();
    } catch (err: any) {
      alert(`Не удалось скачать ZIP-архив: ${err?.message || "Ошибка сервера"}`);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4 animate-in fade-in duration-150">
      {/* Main Solid High-Contrast Container */}
      <div className="w-full max-w-5xl rounded-2xl bg-[#1a1d24] border border-[#3b4252] p-6 text-slate-100 shadow-2xl flex flex-col max-h-[90vh]">
        
        {/* Modal Header */}
        <div className="flex items-center justify-between border-b border-[#2e3440] pb-4 mb-4">
          <div>
            <div className="flex items-center gap-3">
              <h3 className="text-xl font-bold text-white tracking-wide">
                Конструктор документации ГОСТ 34
              </h3>
              <span className="px-3 py-1 rounded-full text-xs font-bold bg-blue-600/30 text-blue-300 border border-blue-400/50">
                ГОСТ 2.104-2006
              </span>
            </div>
            <p className="text-xs text-slate-300 mt-1">
              Проект: <strong className="text-white font-semibold">{calculationName}</strong> • Заказчик: <strong className="text-white font-semibold">{customerName}</strong>
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white bg-[#2e3440] hover:bg-[#3b4252] text-lg font-bold w-9 h-9 rounded-xl flex items-center justify-center transition-colors"
            title="Закрыть"
          >
            ✕
          </button>
        </div>

        {/* High-Contrast Navigation Tabs */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5 mb-5 border-b border-[#2e3440] pb-4">
          {[
            {
              id: "vendor",
              title: "1. ТЗ вендора",
              subtitle: `Загружено ${extractedReqs.length} треб.`,
              icon: "📄",
              badge: extractedReqs.length > 0 ? extractedReqs.length : undefined,
            },
            {
              id: "enrichment",
              title: "2. Нормы и Приказы ИБ",
              subtitle: `Выбрано ${countActiveEnrichments()} ст.`,
              icon: "🛡️",
              badge: countActiveEnrichments(),
            },
            {
              id: "signatures",
              title: "3. Штамп ГОСТ 2.104",
              subtitle: "Подписи и реквизиты",
              icon: "✍️",
            },
            {
              id: "export",
              title: "4. Выпуск и экспорт",
              subtitle: `Тип: ${docType}`,
              icon: "🚀",
            },
          ].map((tab) => {
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id as TabType)}
                className={`flex items-center gap-3 p-3.5 rounded-xl border text-left transition-all relative ${
                  isActive
                    ? "bg-blue-600 border-blue-400 text-white font-bold shadow-lg shadow-blue-600/30 ring-1 ring-blue-300"
                    : "bg-[#242832] border-[#3b4252] text-slate-300 hover:bg-[#2c313d] hover:text-white"
                }`}
              >
                <span className="text-xl">{tab.icon}</span>
                <div className="flex-1 min-w-0">
                  <div className="font-bold text-xs truncate flex items-center justify-between">
                    <span>{tab.title}</span>
                    {tab.badge !== undefined && tab.badge > 0 && (
                      <span className={`px-2 py-0.5 text-[10px] font-mono font-bold rounded-full ml-1 ${
                        isActive ? "bg-white text-blue-700" : "bg-blue-500 text-white"
                      }`}>
                        {tab.badge}
                      </span>
                    )}
                  </div>
                  <div className={`text-[11px] truncate mt-0.5 ${isActive ? "text-blue-100 font-medium" : "text-slate-400"}`}>
                    {tab.subtitle}
                  </div>
                </div>
              </button>
            );
          })}
        </div>

        {/* Tab Content Box - Solid Dark High-Legibility Background */}
        <div className="flex-1 overflow-y-auto pr-1 space-y-4 min-h-[380px]">
          
          {/* TAB 1: Vendor Specifications & File Extraction */}
          {activeTab === "vendor" && (
            <div className="space-y-4 animate-in fade-in duration-150">
              
              {/* Dropzone */}
              <div className="bg-[#242832] p-5 rounded-2xl border border-[#3b4252] space-y-3 shadow-md">
                <div className="flex items-center justify-between">
                  <div>
                    <h4 className="text-sm font-bold text-blue-400 uppercase tracking-wider">
                      Загрузка исходных спецификаций ТЗ / ФТ / ТТ
                    </h4>
                    <p className="text-xs text-slate-300 mt-1">
                      Загрузите файлы вендора (.docx, .txt, .md, .json) для авто-извлечения требований
                    </p>
                  </div>
                  {uploadedFiles.length > 0 && (
                    <span className="px-3 py-1 rounded-lg text-xs font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/40">
                      ✓ Загружено файлов: {uploadedFiles.length}
                    </span>
                  )}
                </div>

                <label className="cursor-pointer flex flex-col items-center justify-center p-7 rounded-xl border-2 border-dashed border-[#434c5e] hover:border-blue-400 bg-[#1c1f26] hover:bg-[#20242e] transition-all">
                  <span className="text-3xl mb-2">📁</span>
                  <span className="text-sm font-bold text-white">
                    {isParsing ? "Идёт обработка и анализ документа..." : "Нажмите или перетащите файлы вендорского ТЗ сюда"}
                  </span>
                  <span className="text-xs text-slate-400 mt-1">
                    Поддерживаются исходные форматы MS Word (.docx), спецификации (.txt, .md, .json)
                  </span>
                  <input
                    type="file"
                    multiple
                    accept=".docx,.txt,.md,.json"
                    onChange={handleFileUpload}
                    className="hidden"
                    disabled={isParsing}
                  />
                </label>

                {uploadedFiles.length > 0 && (
                  <div className="flex flex-wrap gap-2 pt-2 border-t border-[#3b4252]">
                    {uploadedFiles.map((fn, idx) => (
                      <span
                        key={idx}
                        className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium bg-[#2e3440] text-white border border-[#434c5e]"
                      >
                        📄 {fn}
                      </span>
                    ))}
                  </div>
                )}
              </div>

              {/* Requirements Extraction & Cleansing Table */}
              <div className="bg-[#242832] p-5 rounded-2xl border border-[#3b4252] space-y-3 shadow-md">
                <div className="flex flex-col md:flex-row items-start md:items-center justify-between border-b border-[#3b4252] pb-3 gap-3">
                  <div>
                    <h4 className="text-sm font-bold text-blue-400 uppercase tracking-wider flex items-center gap-2">
                      <span>Извлечённые и нормализованные требования ({extractedReqs.length})</span>
                    </h4>
                    <p className="text-xs text-slate-300 mt-0.5">
                      Список структурных пунктов с авто-классификацией по категориям ГОСТ 34
                    </p>
                  </div>
                  
                  {extractedReqs.length > 0 && (
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={handleNormalizeAll}
                        className="px-3 py-1.5 rounded-lg text-xs font-bold bg-[#2e3440] text-slate-200 border border-[#434c5e] hover:bg-[#3b4252] transition-colors flex items-center gap-1.5"
                        title="Удалить спецсимволы, точки, буллеты и присвоить стандартные коды ГОСТ 34"
                      >
                        <span>🧹 Очистить (правила)</span>
                      </button>

                      <button
                        type="button"
                        onClick={handleLlmNormalize}
                        disabled={isLlmNormalizing}
                        className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 ${
                          llmAvailable
                            ? "bg-purple-600 hover:bg-purple-500 text-white shadow-md shadow-purple-600/30 border border-purple-400/40"
                            : "bg-[#2e3440] text-slate-400 border border-[#434c5e] hover:bg-[#3b4252]"
                        }`}
                        title={
                          llmAvailable
                            ? `Использовать локальную нейросеть (${llmModels[0] || 'Ollama'}) для смысловой очистки и структурирования по ГОСТ 34`
                            : "Запустите Ollama локально (ollama run llama3.2) для включения нейросетевой очистки"
                        }
                      >
                        <span>{isLlmNormalizing ? "⏳ Идет обработка ИИ..." : "🤖 ИИ-Нормализация (Ollama)"}</span>
                        {llmAvailable && !isLlmNormalizing && (
                          <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                        )}
                      </button>

                      <button
                        type="button"
                        onClick={() => setShowLlmSettings(!showLlmSettings)}
                        className="px-2.5 py-1.5 rounded-lg text-xs font-bold bg-[#2e3440] text-slate-300 border border-[#434c5e] hover:text-white hover:bg-[#3b4252] transition-colors"
                        title="Настройки подключения к Ollama / LM Studio"
                      >
                        ⚙️ Настройки ИИ
                      </button>

                      <button
                        type="button"
                        onClick={() => setExtractedReqs([])}
                        className="text-xs font-bold text-red-400 hover:text-red-300 hover:underline px-2 py-1"
                      >
                        Очистить
                      </button>
                    </div>
                  )}
                </div>

                {/* Interactive LLM / Ollama & LM Studio Settings Drawer */}
                {showLlmSettings && (
                  <div className="bg-[#1c1f26] p-4 rounded-xl border border-purple-500/40 space-y-3 animate-in fade-in duration-150">
                    <div className="flex items-center justify-between border-b border-[#3b4252] pb-2">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-bold text-purple-400">⚙️ Настройки ИИ-модели (Ollama / LM Studio / OpenAI)</span>
                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                          llmAvailable ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/40" : "bg-red-500/20 text-red-300 border border-red-500/40"
                        }`}>
                          {llmAvailable ? "✓ Сервер доступен" : "✕ Сервер недоступен"}
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleCheckLlmStatus(llmEndpoint, llmProvider)}
                        className="text-xs text-purple-300 hover:underline font-bold"
                      >
                        🔄 Проверить связь
                      </button>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
                      {/* Provider Select */}
                      <div>
                        <label className="block text-[#a3be8c] text-[11px] font-bold mb-1">
                          Провайдер ИИ
                        </label>
                        <select
                          value={llmProvider}
                          onChange={(e) => {
                            const newProv = e.target.value as any;
                            setLlmProvider(newProv);
                            const defaultEp = newProv === "ollama" ? "http://localhost:11434" : "http://localhost:1234/v1";
                            setLlmEndpoint(defaultEp);
                            saveLlmSettings(newProv, defaultEp, llmSelectedModel, llmApiKey);
                            handleCheckLlmStatus(defaultEp, newProv);
                          }}
                          className="w-full bg-[#242832] border border-[#434c5e] rounded-lg px-3 py-1.5 text-white font-bold focus:border-purple-400 focus:outline-none"
                        >
                          <option value="ollama">Ollama (по умолчанию: 11434)</option>
                          <option value="openai_compatible">LM Studio / OpenAI Local (1234 / v1)</option>
                        </select>
                      </div>

                      {/* Endpoint Input */}
                      <div>
                        <label className="block text-[#a3be8c] text-[11px] font-bold mb-1">
                          Адрес сервера (Endpoint)
                        </label>
                        <input
                          type="text"
                          value={llmEndpoint}
                          onChange={(e) => {
                            setLlmEndpoint(e.target.value);
                            saveLlmSettings(llmProvider, e.target.value, llmSelectedModel, llmApiKey);
                          }}
                          className="w-full bg-[#242832] border border-[#434c5e] rounded-lg px-3 py-1.5 text-white font-mono focus:border-purple-400 focus:outline-none"
                          placeholder="http://localhost:11434"
                        />
                      </div>

                      {/* Model Select / Manual Input */}
                      <div>
                        <label className="block text-[#a3be8c] text-[11px] font-bold mb-1">
                          Модель нейросети
                        </label>
                        {llmModels.length > 0 ? (
                          <select
                            value={llmSelectedModel}
                            onChange={(e) => {
                              setLlmSelectedModel(e.target.value);
                              saveLlmSettings(llmProvider, llmEndpoint, e.target.value, llmApiKey);
                            }}
                            className="w-full bg-[#242832] border border-[#434c5e] rounded-lg px-3 py-1.5 text-white font-bold focus:border-purple-400 focus:outline-none"
                          >
                            {llmModels.map((m) => (
                              <option key={m} value={m}>{m}</option>
                            ))}
                          </select>
                        ) : (
                          <input
                            type="text"
                            value={llmSelectedModel}
                            onChange={(e) => {
                              setLlmSelectedModel(e.target.value);
                              saveLlmSettings(llmProvider, llmEndpoint, e.target.value, llmApiKey);
                            }}
                            placeholder="llama3.2 / qwen2.5 / local-model"
                            className="w-full bg-[#242832] border border-[#434c5e] rounded-lg px-3 py-1.5 text-white focus:border-purple-400 focus:outline-none"
                          />
                        )}
                      </div>
                    </div>

                    {/* Presets Bar */}
                    <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-[#3b4252]/60 text-[11px]">
                      <span className="text-slate-400">Быстрые пресеты:</span>
                      <button
                        type="button"
                        onClick={() => {
                          setLlmProvider("ollama");
                          setLlmEndpoint("http://localhost:11434");
                          saveLlmSettings("ollama", "http://localhost:11434", llmSelectedModel, llmApiKey);
                          handleCheckLlmStatus("http://localhost:11434", "ollama");
                        }}
                        className="px-2 py-0.5 rounded bg-[#2e3440] hover:bg-[#3b4252] text-slate-200 border border-[#434c5e]"
                      >
                        Ollama (11434)
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setLlmProvider("openai_compatible");
                          setLlmEndpoint("http://localhost:1234/v1");
                          saveLlmSettings("openai_compatible", "http://localhost:1234/v1", llmSelectedModel, llmApiKey);
                          handleCheckLlmStatus("http://localhost:1234/v1", "openai_compatible");
                        }}
                        className="px-2 py-0.5 rounded bg-[#2e3440] hover:bg-[#3b4252] text-slate-200 border border-[#434c5e]"
                      >
                        LM Studio (1234)
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setLlmProvider("openai_compatible");
                          setLlmEndpoint("http://localhost:8000/v1");
                          saveLlmSettings("openai_compatible", "http://localhost:8000/v1", llmSelectedModel, llmApiKey);
                          handleCheckLlmStatus("http://localhost:8000/v1", "openai_compatible");
                        }}
                        className="px-2 py-0.5 rounded bg-[#2e3440] hover:bg-[#3b4252] text-slate-200 border border-[#434c5e]"
                      >
                        vLLM / LocalAI (8000)
                      </button>
                    </div>
                  </div>
                )}

                {/* Category Filter Pills */}
                {extractedReqs.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 pb-1">
                    {[
                      { id: "all", label: "Все категории", count: extractedReqs.length },
                      { id: "functional", label: "Функциональные", count: extractedReqs.filter(r => r.category === "functional").length },
                      { id: "security", label: "ИБ и Безопасность", count: extractedReqs.filter(r => r.category === "security").length },
                      { id: "reliability", label: "Надежность и SLA", count: extractedReqs.filter(r => r.category === "reliability").length },
                      { id: "technical", label: "Технические / ПО", count: extractedReqs.filter(r => r.category === "technical").length },
                    ].map((cat) => (
                      <button
                        key={cat.id}
                        type="button"
                        onClick={() => setSelectedCategoryFilter(cat.id)}
                        className={`px-2.5 py-1 rounded-lg text-[11px] font-bold transition-all ${
                          selectedCategoryFilter === cat.id
                            ? "bg-blue-600 text-white shadow-sm"
                            : "bg-[#1c1f26] text-slate-300 hover:bg-[#2e3440] border border-[#3b4252]"
                        }`}
                      >
                        {cat.label} ({cat.count})
                      </button>
                    ))}
                  </div>
                )}

                {extractedReqs.length === 0 ? (
                  <div className="text-xs text-slate-400 italic p-6 text-center border border-dashed border-[#434c5e] rounded-xl bg-[#1c1f26]">
                    Требования пока не извлечены. Загрузите файл ТЗ (.docx) выше или добавьте пункты вручную.
                  </div>
                ) : (
                  <div className="max-h-64 overflow-y-auto rounded-xl border border-[#3b4252] bg-[#1c1f26]">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-[#2e3440] text-white sticky top-0 border-b border-[#434c5e]">
                        <tr>
                          <th className="p-3 w-32 font-bold text-blue-300">Код ГОСТ</th>
                          <th className="p-3 w-28 font-bold text-slate-300">Категория</th>
                          <th className="p-3 font-bold text-white">Полное наименование и текст требования</th>
                          <th className="p-3 w-28 font-bold text-slate-300">Источник</th>
                          <th className="p-3 w-12 text-center font-bold text-slate-300">Удалить</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#2e3440]">
                        {extractedReqs
                          .filter((r) => selectedCategoryFilter === "all" || r.category === selectedCategoryFilter)
                          .map((req) => (
                            <tr key={req.id} className="hover:bg-[#282c37] transition-colors">
                              <td className="p-3 font-mono font-bold text-blue-400 align-top">
                                {req.code}
                              </td>
                              <td className="p-3 align-top">
                                <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                                  req.category === 'security'
                                    ? 'bg-red-500/20 text-red-300 border border-red-500/30'
                                    : req.category === 'reliability'
                                    ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                                    : req.category === 'technical'
                                    ? 'bg-purple-500/20 text-purple-300 border border-purple-500/30'
                                    : 'bg-blue-500/20 text-blue-300 border border-blue-500/30'
                                }`}>
                                  {req.category === 'security' ? 'ИБ' : req.category === 'reliability' ? 'НАД' : req.category === 'technical' ? 'ТЕХ' : 'ФУНК'}
                                </span>
                              </td>
                              <td className="p-3 text-slate-100 break-words align-top space-y-1">
                                <div className="font-semibold text-white">{req.title}</div>
                                {req.title !== req.description && (
                                  <div className="text-slate-300 text-[11px] leading-relaxed">{req.description}</div>
                                )}
                              </td>
                              <td className="p-3 text-slate-400 text-[11px] align-top space-y-1">
                                <div className="truncate">{req.sourceFile || "—"}</div>
                                {req.normalizedBy && (
                                  <div
                                    className="inline-block px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-300 border border-amber-500/30 text-[10px]"
                                    title={req.originalText ? `Исходная формулировка: ${req.originalText}` : undefined}
                                  >
                                    ИИ-предложение
                                  </div>
                                )}
                              </td>
                              <td className="p-3 text-center align-top">
                                <button
                                  type="button"
                                  onClick={() => handleDeleteReq(req.id)}
                                  className="text-red-400 hover:text-red-300 font-bold text-sm px-2 py-0.5 rounded bg-red-500/10 hover:bg-red-500/20 transition-colors"
                                >
                                  ✕
                                </button>
                              </td>
                            </tr>
                          ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {/* Manual Add Input */}
                <div className="pt-2">
                  <label className="block text-xs font-bold text-slate-300 mb-2">
                    Добавить требование вручную:
                  </label>
                  <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
                    <input
                      type="text"
                      placeholder="Код (ТР-Ф-01)"
                      value={newReqCode}
                      onChange={(e) => setNewReqCode(e.target.value)}
                      className="bg-[#1c1f26] border border-[#434c5e] rounded-lg px-3 py-2 text-xs text-white placeholder-slate-400 focus:border-blue-400 focus:outline-none"
                    />
                    <input
                      type="text"
                      placeholder="Название пункта ТЗ"
                      value={newReqTitle}
                      onChange={(e) => setNewReqTitle(e.target.value)}
                      className="bg-[#1c1f26] border border-[#434c5e] rounded-lg px-3 py-2 text-xs text-white placeholder-slate-400 focus:border-blue-400 focus:outline-none"
                    />
                    <input
                      type="text"
                      placeholder="Полный текст требования"
                      value={newReqDesc}
                      onChange={(e) => setNewReqDesc(e.target.value)}
                      className="bg-[#1c1f26] border border-[#434c5e] rounded-lg px-3 py-2 text-xs text-white placeholder-slate-400 focus:border-blue-400 focus:outline-none"
                    />
                    <button
                      type="button"
                      onClick={handleAddManualReq}
                      className="bg-blue-600 hover:bg-blue-500 text-white font-bold rounded-lg px-4 py-2 text-xs shadow-md transition-all"
                    >
                      + Добавить пункт
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: Regulatory Enrichment Standards Selector */}
          {activeTab === "enrichment" && (
            <div className="space-y-4 animate-in fade-in duration-150">
              <div className="bg-[#242832] p-5 rounded-2xl border border-[#3b4252] space-y-4 shadow-md">
                
                {/* Header Controls */}
                <div className="flex items-center justify-between border-b border-[#3b4252] pb-3">
                  <div>
                    <h4 className="text-sm font-bold text-blue-400 uppercase tracking-wider flex items-center gap-2">
                      <span>🛡️ Нормативное авто-обогащение требованиями РФ</span>
                    </h4>
                    <p className="text-xs text-slate-300 mt-1">
                      Отметьте применимые приказы регуляторов, стандарты ИБ и законодательные акты
                    </p>
                  </div>

                  <div className="flex items-center gap-4">
                    <label className="flex items-center gap-2 text-xs font-bold text-white cursor-pointer bg-[#1c1f26] px-3 py-1.5 rounded-lg border border-[#434c5e]">
                      <input
                        type="checkbox"
                        checked={enrich}
                        onChange={(e) => setEnrich(e.target.checked)}
                        className="w-4 h-4 accent-blue-500 rounded cursor-pointer"
                      />
                      <span>Включить обогащение</span>
                    </label>

                    {enrich && (
                      <div className="flex items-center gap-2 text-xs border-l border-[#3b4252] pl-3">
                        <button
                          type="button"
                          onClick={() => toggleAllEnrichments(true)}
                          className="text-blue-400 hover:text-blue-300 hover:underline font-bold"
                        >
                          Выбрать все
                        </button>
                        <span className="text-slate-500">•</span>
                        <button
                          type="button"
                          onClick={() => toggleAllEnrichments(false)}
                          className="text-slate-400 hover:text-slate-200 hover:underline font-semibold"
                        >
                          Снять все
                        </button>
                      </div>
                    )}
                  </div>
                </div>

                {enrich ? (
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 text-xs">
                    
                    {/* FSTEK Group */}
                    <div className="col-span-full font-bold text-blue-400 uppercase tracking-wider text-[11px] pt-1">
                      1. Приказы ФСТЭК России
                    </div>

                    <label className="flex items-start gap-3 p-3 rounded-xl border border-[#3b4252] bg-[#1c1f26] hover:border-blue-400 cursor-pointer transition-colors">
                      <input
                        type="checkbox"
                        checked={optFstek21}
                        onChange={(e) => setOptFstek21(e.target.checked)}
                        className="w-4 h-4 mt-0.5 accent-blue-500 rounded cursor-pointer"
                      />
                      <div>
                        <span className="font-bold text-white block">Приказ ФСТЭК России № 21</span>
                        <span className="text-slate-300 text-[11px] block mt-0.5 leading-relaxed">
                          Состав и содержание мер по защите персональных данных в ИСПДн (УЗ-1..3).
                        </span>
                      </div>
                    </label>

                    <label className="flex items-start gap-3 p-3 rounded-xl border border-[#3b4252] bg-[#1c1f26] hover:border-blue-400 cursor-pointer transition-colors">
                      <input
                        type="checkbox"
                        checked={optFstek117}
                        onChange={(e) => setOptFstek117(e.target.checked)}
                        className="w-4 h-4 mt-0.5 accent-blue-500 rounded cursor-pointer"
                      />
                      <div>
                        <span className="font-bold text-white block">Приказ ФСТЭК России № 117</span>
                        <span className="text-slate-300 text-[11px] block mt-0.5 leading-relaxed">
                          Безопасная разработка ПО по ГОСТ Р 56939-2016 (SAST, DAST, SCA, НДВ).
                        </span>
                      </div>
                    </label>

                    <label className="flex items-start gap-3 p-3 rounded-xl border border-[#3b4252] bg-[#1c1f26] hover:border-blue-400 cursor-pointer transition-colors">
                      <input
                        type="checkbox"
                        checked={optFstek239}
                        onChange={(e) => setOptFstek239(e.target.checked)}
                        className="w-4 h-4 mt-0.5 accent-blue-500 rounded cursor-pointer"
                      />
                      <div>
                        <span className="font-bold text-white block">Приказ ФСТЭК России № 239</span>
                        <span className="text-slate-300 text-[11px] block mt-0.5 leading-relaxed">
                          Требования безопасности для значимых объектов КИИ (1, 2 и 3 категории).
                        </span>
                      </div>
                    </label>

                    {/* Central Bank Group */}
                    <div className="col-span-full font-bold text-blue-400 uppercase tracking-wider text-[11px] pt-3 border-t border-[#3b4252]">
                      2. Стандарты и Положения Банка России (ЦБ РФ)
                    </div>

                    <label className="flex items-start gap-3 p-3 rounded-xl border border-[#3b4252] bg-[#1c1f26] hover:border-blue-400 cursor-pointer transition-colors">
                      <input
                        type="checkbox"
                        checked={optGost57580}
                        onChange={(e) => setOptGost57580(e.target.checked)}
                        className="w-4 h-4 mt-0.5 accent-blue-500 rounded cursor-pointer"
                      />
                      <div>
                        <span className="font-bold text-white block">ГОСТ Р 57580.1-2017</span>
                        <span className="text-slate-300 text-[11px] block mt-0.5 leading-relaxed">
                          Безопасность финансовых операций и требования СТО БР ИББС.
                        </span>
                      </div>
                    </label>

                    <label className="flex items-start gap-3 p-3 rounded-xl border border-[#3b4252] bg-[#1c1f26] hover:border-blue-400 cursor-pointer transition-colors">
                      <input
                        type="checkbox"
                        checked={optCb683}
                        onChange={(e) => setOptCb683(e.target.checked)}
                        className="w-4 h-4 mt-0.5 accent-blue-500 rounded cursor-pointer"
                      />
                      <div>
                        <span className="font-bold text-white block">Положение ЦБ РФ № 683-П</span>
                        <span className="text-slate-300 text-[11px] block mt-0.5 leading-relaxed">
                          Защита информации для кредитных организаций и контроль API.
                        </span>
                      </div>
                    </label>

                    <label className="flex items-start gap-3 p-3 rounded-xl border border-[#3b4252] bg-[#1c1f26] hover:border-blue-400 cursor-pointer transition-colors">
                      <input
                        type="checkbox"
                        checked={optCb757}
                        onChange={(e) => setOptCb757(e.target.checked)}
                        className="w-4 h-4 mt-0.5 accent-blue-500 rounded cursor-pointer"
                      />
                      <div>
                        <span className="font-bold text-white block">Положение ЦБ РФ № 757-П</span>
                        <span className="text-slate-300 text-[11px] block mt-0.5 leading-relaxed">
                          Защита информации для некредитных финансовых организаций (НФО).
                        </span>
                      </div>
                    </label>

                    <label className="flex items-start gap-3 p-3 rounded-xl border border-[#3b4252] bg-[#1c1f26] hover:border-blue-400 cursor-pointer transition-colors">
                      <input
                        type="checkbox"
                        checked={optCb719}
                        onChange={(e) => setOptCb719(e.target.checked)}
                        className="w-4 h-4 mt-0.5 accent-blue-500 rounded cursor-pointer"
                      />
                      <div>
                        <span className="font-bold text-white block">Положение ЦБ РФ № 719-П</span>
                        <span className="text-slate-300 text-[11px] block mt-0.5 leading-relaxed">
                          Антифрод-журналирование, СКЗИ/HSM и электронная подпись (УКЭП).
                        </span>
                      </div>
                    </label>

                    {/* KII & Government Regulators Group */}
                    <div className="col-span-full font-bold text-blue-400 uppercase tracking-wider text-[11px] pt-3 border-t border-[#3b4252]">
                      3. Критическая инфраструктура (КИИ), ФСБ и Импортозамещение
                    </div>

                    <label className="flex items-start gap-3 p-3 rounded-xl border border-[#3b4252] bg-[#1c1f26] hover:border-blue-400 cursor-pointer transition-colors">
                      <input
                        type="checkbox"
                        checked={optFz187}
                        onChange={(e) => setOptFz187(e.target.checked)}
                        className="w-4 h-4 mt-0.5 accent-blue-500 rounded cursor-pointer"
                      />
                      <div>
                        <span className="font-bold text-white block">Федеральный закон № 187-ФЗ</span>
                        <span className="text-slate-300 text-[11px] block mt-0.5 leading-relaxed">
                          О безопасности критической информационной инфраструктуры РФ.
                        </span>
                      </div>
                    </label>

                    <label className="flex items-start gap-3 p-3 rounded-xl border border-[#3b4252] bg-[#1c1f26] hover:border-blue-400 cursor-pointer transition-colors">
                      <input
                        type="checkbox"
                        checked={optFsb282}
                        onChange={(e) => setOptFsb282(e.target.checked)}
                        className="w-4 h-4 mt-0.5 accent-blue-500 rounded cursor-pointer"
                      />
                      <div>
                        <span className="font-bold text-white block">Приказ ФСБ России № 282</span>
                        <span className="text-slate-300 text-[11px] block mt-0.5 leading-relaxed">
                          Интеграция с системой ГосСОПКА и передача инцидентов в НКЦКИ.
                        </span>
                      </div>
                    </label>

                    <label className="flex items-start gap-3 p-3 rounded-xl border border-[#3b4252] bg-[#1c1f26] hover:border-blue-400 cursor-pointer transition-colors">
                      <input
                        type="checkbox"
                        checked={optFz188}
                        onChange={(e) => setOptFz188(e.target.checked)}
                        className="w-4 h-4 mt-0.5 accent-blue-500 rounded cursor-pointer"
                      />
                      <div>
                        <span className="font-bold text-white block">Федеральный закон № 188-ФЗ</span>
                        <span className="text-slate-300 text-[11px] block mt-0.5 leading-relaxed">
                          Реестр отечественного ПО (совместимость с Astra Linux/PostgreSQL).
                        </span>
                      </div>
                    </label>

                    {/* Reliability & Ergonomics Group */}
                    <div className="col-span-full font-bold text-blue-400 uppercase tracking-wider text-[11px] pt-3 border-t border-[#3b4252]">
                      4. Персональные данные, Надежность SLA и Эргономика
                    </div>

                    <label className="flex items-start gap-3 p-3 rounded-xl border border-[#3b4252] bg-[#1c1f26] hover:border-blue-400 cursor-pointer transition-colors">
                      <input
                        type="checkbox"
                        checked={optFz152}
                        onChange={(e) => setOptFz152(e.target.checked)}
                        className="w-4 h-4 mt-0.5 accent-blue-500 rounded cursor-pointer"
                      />
                      <div>
                        <span className="font-bold text-white block">152-ФЗ / 242-ФЗ</span>
                        <span className="text-slate-300 text-[11px] block mt-0.5 leading-relaxed">
                          Физическая локализация баз данных персональных данных в ЦОД РФ.
                        </span>
                      </div>
                    </label>

                    <label className="flex items-start gap-3 p-3 rounded-xl border border-[#3b4252] bg-[#1c1f26] hover:border-blue-400 cursor-pointer transition-colors">
                      <input
                        type="checkbox"
                        checked={optSla}
                        onChange={(e) => setOptSla(e.target.checked)}
                        className="w-4 h-4 mt-0.5 accent-blue-500 rounded cursor-pointer"
                      />
                      <div>
                        <span className="font-bold text-white block">SLA Доступность 99.9%</span>
                        <span className="text-slate-300 text-[11px] block mt-0.5 leading-relaxed">
                          Непрерывность 24/7 (RTO ≤ 15 мин, RPO ≤ 5 мин, WAL-репликация).
                        </span>
                      </div>
                    </label>

                    <label className="flex items-start gap-3 p-3 rounded-xl border border-[#3b4252] bg-[#1c1f26] hover:border-blue-400 cursor-pointer transition-colors">
                      <input
                        type="checkbox"
                        checked={optWcag}
                        onChange={(e) => setOptWcag(e.target.checked)}
                        className="w-4 h-4 mt-0.5 accent-blue-500 rounded cursor-pointer"
                      />
                      <div>
                        <span className="font-bold text-white block">ГОСТ Р 52872-2019</span>
                        <span className="text-slate-300 text-[11px] block mt-0.5 leading-relaxed">
                          Стандарт доступности веб-интерфейсов (WCAG 2.1 AA, отклик ≤ 1.5 с).
                        </span>
                      </div>
                    </label>
                  </div>
                ) : (
                  <div className="text-xs text-slate-400 italic p-6 text-center border border-dashed border-[#434c5e] rounded-xl bg-[#1c1f26]">
                    Авто-обогащение отключено. В документ будут включены только извлеченные требования вендора.
                  </div>
                )}
              </div>
            </div>
          )}

          {/* TAB 3: Signatures & GOST 2.104 Frame Requisites */}
          {activeTab === "signatures" && (
            <div className="space-y-4 animate-in fade-in duration-150">
              <div className="bg-[#242832] p-5 rounded-2xl border border-[#3b4252] space-y-4 shadow-md">
                <div>
                  <h4 className="text-sm font-bold text-blue-400 uppercase tracking-wider">
                    ✍️ Данные основной надписи (ГОСТ 2.104-2006 Форма 2 и 2а)
                  </h4>
                  <p className="text-xs text-slate-300 mt-1">
                    Заполните ФИО должностных лиц для вывода в штампах нормоконтроля документа
                  </p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* Left Column: Developer Team Signatures */}
                  <div className="bg-[#1c1f26] p-4 rounded-xl border border-[#3b4252] space-y-3">
                    <span className="text-xs font-bold text-white uppercase tracking-wider block border-b border-[#3b4252] pb-2">
                      Согласующие от Исполнителя
                    </span>
                    <div className="space-y-3 text-xs">
                      <div>
                        <label className="block text-slate-300 text-[11px] font-bold mb-1">
                          Разработал (ФИО)
                        </label>
                        <input
                          type="text"
                          value={developer}
                          onChange={(e) => setDeveloper(e.target.value)}
                          className="w-full bg-[#242832] border border-[#434c5e] rounded-lg px-3 py-2 text-white focus:border-blue-400 focus:outline-none"
                        />
                      </div>
                      <div>
                        <label className="block text-slate-300 text-[11px] font-bold mb-1">
                          Проверил (ФИО)
                        </label>
                        <input
                          type="text"
                          value={checker}
                          onChange={(e) => setChecker(e.target.value)}
                          className="w-full bg-[#242832] border border-[#434c5e] rounded-lg px-3 py-2 text-white focus:border-blue-400 focus:outline-none"
                        />
                      </div>
                      <div>
                        <label className="block text-slate-300 text-[11px] font-bold mb-1">
                          Нормоконтроль / Н.контр. (ФИО)
                        </label>
                        <input
                          type="text"
                          value={normControl}
                          onChange={(e) => setNormControl(e.target.value)}
                          className="w-full bg-[#242832] border border-[#434c5e] rounded-lg px-3 py-2 text-white focus:border-blue-400 focus:outline-none"
                        />
                      </div>
                      <div>
                        <label className="block text-slate-300 text-[11px] font-bold mb-1">
                          Утвердил от Исполнителя (ФИО)
                        </label>
                        <input
                          type="text"
                          value={approver}
                          onChange={(e) => setApprover(e.target.value)}
                          className="w-full bg-[#242832] border border-[#434c5e] rounded-lg px-3 py-2 text-white focus:border-blue-400 focus:outline-none"
                        />
                      </div>
                    </div>
                  </div>

                  {/* Right Column: Customer Signatures & Contract Info */}
                  <div className="bg-[#1c1f26] p-4 rounded-xl border border-[#3b4252] space-y-3">
                    <span className="text-xs font-bold text-white uppercase tracking-wider block border-b border-[#3b4252] pb-2">
                      Согласующие от Заказчика и реквизиты
                    </span>
                    <div className="space-y-3 text-xs">
                      <div>
                        <label className="block text-slate-300 text-[11px] font-bold mb-1">
                          Утвердил от Заказчика (ФИО)
                        </label>
                        <input
                          type="text"
                          value={customerApprover}
                          onChange={(e) => setCustomerApprover(e.target.value)}
                          className="w-full bg-[#242832] border border-[#434c5e] rounded-lg px-3 py-2 text-white focus:border-blue-400 focus:outline-none"
                        />
                      </div>
                      <div>
                        <label className="block text-slate-300 text-[11px] font-bold mb-1">
                          Номер договора / Шифр проекта
                        </label>
                        <input
                          type="text"
                          value={contractNumber}
                          onChange={(e) => setContractNumber(e.target.value)}
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
                          onChange={(e) => setCity(e.target.value)}
                          className="w-full bg-[#242832] border border-[#434c5e] rounded-lg px-3 py-2 text-white focus:border-blue-400 focus:outline-none"
                        />
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* TAB 4: Document Type Selector & Download Execution */}
          {activeTab === "export" && (
            <div className="space-y-4 animate-in fade-in duration-150">
              <div className="bg-[#242832] p-5 rounded-2xl border border-[#3b4252] space-y-4 shadow-md">
                <div>
                  <h4 className="text-sm font-bold text-blue-400 uppercase tracking-wider">
                    🚀 Выбор типа нормативного документа и генерация
                  </h4>
                  <p className="text-xs text-slate-300 mt-1">
                    Выберите требуемый документ из комплекта нормативной документации по ГОСТ 34
                  </p>
                </div>

                {/* 5 Document Types Grid */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  {DOCUMENT_TYPE_CARDS.map((item) => {
                    const isSelected = docType === item.type;
                    return (
                      <button
                        key={item.type}
                        type="button"
                        onClick={() => setDocType(item.type)}
                        className={`p-4 rounded-xl border text-left transition-all ${
                          isSelected
                            ? "bg-blue-600 border-blue-400 text-white font-bold shadow-xl shadow-blue-600/30 ring-2 ring-blue-300"
                            : "bg-[#1c1f26] border-[#3b4252] text-slate-300 hover:border-slate-400 hover:text-white"
                        }`}
                      >
                        <div className="flex items-center justify-between mb-1">
                          <span className={`font-bold text-sm ${isSelected ? "text-white" : "text-slate-100"}`}>
                            {item.title}
                          </span>
                          <span className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded ${
                            isSelected ? "bg-white text-blue-700" : "bg-[#2e3440] text-blue-300 border border-[#434c5e]"
                          }`}>
                            {item.gost}
                          </span>
                        </div>
                        <p className={`text-xs mt-2 leading-relaxed ${isSelected ? "text-blue-100" : "text-slate-400"}`}>
                          {item.desc}
                        </p>
                      </button>
                    );
                  })}
                </div>

                {/* Summary Readiness Card */}
                <div className="bg-[#1c1f26] p-4.5 rounded-xl border border-[#3b4252] flex flex-col md:flex-row items-center justify-between gap-4 mt-4 shadow-inner">
                  <div className="space-y-1.5 text-xs">
                    <div className="font-bold text-white">
                      Сводная готовность к формированию:
                    </div>
                    <div className="text-slate-300 leading-relaxed">
                      • Выбранный документ: <strong className="text-blue-400 font-bold">{docType}</strong>
                      <br />
                      • Извлечённых требований вендора: <strong className="text-white font-bold">{extractedReqs.length}</strong>
                      <br />
                      • Включённых государственных стандартов: <strong className="text-white font-bold">{countActiveEnrichments()} из {ENRICHMENT_OPTION_KEYS.length}</strong>
                    </div>
                  </div>

                  <div className="flex flex-col sm:flex-row items-center gap-3 w-full md:w-auto">
                    <button
                      type="button"
                      onClick={handleDownload}
                      className="w-full sm:w-auto px-6 py-3 rounded-xl text-xs font-bold bg-blue-600 hover:bg-blue-500 text-white shadow-lg shadow-blue-600/30 transition-all flex items-center justify-center gap-2 border border-blue-400/30"
                    >
                      <span>Сформировать {docType} (.docx)</span>
                    </button>

                    <button
                      type="button"
                      onClick={handleDownloadZip}
                      className="w-full sm:w-auto px-6 py-3 rounded-xl text-xs font-bold bg-emerald-600 hover:bg-emerald-500 text-white shadow-lg shadow-emerald-600/30 transition-all flex items-center justify-center gap-2 border border-emerald-400/30"
                    >
                      <span>📦 Скачать весь комплект (ZIP-архив)</span>
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Modal Footer Controls */}
        <div className="flex items-center justify-between border-t border-[#2e3440] pt-4 mt-4">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl text-xs font-bold bg-[#2e3440] text-slate-300 hover:text-white hover:bg-[#3b4252] transition-colors"
          >
            Закрыть
          </button>

          <div className="flex items-center gap-2.5">
            {activeTab !== "vendor" && (
              <button
                type="button"
                onClick={() => {
                  if (activeTab === "export") setActiveTab("signatures");
                  else if (activeTab === "signatures") setActiveTab("enrichment");
                  else if (activeTab === "enrichment") setActiveTab("vendor");
                }}
                className="px-4.5 py-2 rounded-xl text-xs font-bold bg-[#2e3440] text-white hover:bg-[#3b4252] border border-[#434c5e] transition-colors"
              >
                ← Назад
              </button>
            )}

            {activeTab !== "export" ? (
              <button
                type="button"
                onClick={() => {
                  if (activeTab === "vendor") setActiveTab("enrichment");
                  else if (activeTab === "enrichment") setActiveTab("signatures");
                  else if (activeTab === "signatures") setActiveTab("export");
                }}
                className="px-6 py-2 rounded-xl text-xs font-bold bg-blue-600 hover:bg-blue-500 text-white shadow-md shadow-blue-600/30 transition-colors flex items-center gap-1.5"
              >
                <span>Далее →</span>
              </button>
            ) : (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleDownload}
                  className="px-5 py-2 rounded-xl text-xs font-bold bg-blue-600 hover:bg-blue-500 text-white shadow-md shadow-blue-600/30 transition-colors"
                >
                  <span>Сформировать {docType}</span>
                </button>
                <button
                  type="button"
                  onClick={handleDownloadZip}
                  className="px-5 py-2 rounded-xl text-xs font-bold bg-emerald-600 hover:bg-emerald-500 text-white shadow-md shadow-emerald-600/30 transition-colors flex items-center gap-1.5"
                >
                  <span>📦 Весь комплект (ZIP)</span>
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
