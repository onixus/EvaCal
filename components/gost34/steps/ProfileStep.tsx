'use client';

import { GOST34_PROFILES } from '@/lib/gost34/standards/profiles';
import { LAYOUT_PROFILES } from '@/lib/gost34/exporters/layout';
import type { LayoutProfileId } from '@/lib/gost34/exporters/layout';
import type { GostDocumentType } from '@/lib/gost34/types';
import { PANEL_CLASS } from '../wizardShared';
import MigrationPanel from '../MigrationPanel';

/** Profiles the wizard may offer: a preview profile has no migrated structure yet. */
const SELECTABLE_PROFILES = GOST34_PROFILES.filter((profile) => profile.status === 'stable');
const LAYOUT_PROFILE_CARDS = Object.values(LAYOUT_PROFILES);

interface ProfileStepProps {
  calculationId: string;
  standardProfileId: string;
  layoutProfileId: string;
  docType: GostDocumentType;
  onStandardProfileChange: (id: string) => void;
  onLayoutProfileChange: (id: LayoutProfileId) => void;
  onDocTypeChange: (docType: GostDocumentType) => void;
}

export default function ProfileStep({
  calculationId,
  standardProfileId,
  layoutProfileId,
  docType,
  onStandardProfileChange,
  onLayoutProfileChange,
  onDocTypeChange,
}: ProfileStepProps) {
  const activeProfile =
    SELECTABLE_PROFILES.find((profile) => profile.id === standardProfileId) ||
    SELECTABLE_PROFILES[0];

  const documentCards = [...activeProfile.documentTypes].sort((a, b) => a.zipOrder - b.zipOrder);

  return (
    <div className="space-y-4 animate-in fade-in duration-150">
      <MigrationPanel
        calculationId={calculationId}
        docType={docType}
        onMigrated={onStandardProfileChange}
      />

      <div className={`${PANEL_CLASS} space-y-4`}>
        <div>
          <h4 className="text-sm font-bold text-brand-700 dark:text-nord-frost2 uppercase tracking-wider">
            Редакция нормативного профиля
          </h4>
          <p className="text-xs text-slate-600 dark:text-nord-4 mt-1">
            Профиль задаёт структуру документа, ссылки на стандарты и состав комплекта.
            Legacy-профиль применяется только к ранее выпущенным проектам.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {SELECTABLE_PROFILES.map((profile) => {
            const isSelected = profile.id === activeProfile.id;
            const isLegacy = profile.version === '1989';
            return (
              <button
                key={profile.id}
                type="button"
                onClick={() => onStandardProfileChange(profile.id)}
                aria-pressed={isSelected}
                className={`p-4 rounded-xl border text-left transition-all ${
                  isSelected
                    ? 'bg-brand-600 border-brand-500 text-white shadow-lg shadow-brand-600/20 ring-1 ring-brand-200'
                    : 'bg-white dark:bg-nord-1 border-slate-200 dark:border-nord-3 text-slate-700 dark:text-nord-4 hover:border-slate-300 hover:bg-slate-50 dark:hover:bg-nord-3'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-bold text-sm">{profile.name}</span>
                  <span
                    className={`text-[10px] font-bold px-2 py-0.5 rounded ${
                      isSelected
                        ? 'bg-white text-blue-700'
                        : isLegacy
                          ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                          : 'bg-slate-100 dark:bg-nord-3 text-blue-300 border border-slate-300 dark:border-nord-3'
                    }`}
                  >
                    {isLegacy ? 'legacy' : 'актуальный'}
                  </span>
                </div>
                <p
                  className={`text-[11px] mt-1.5 leading-relaxed ${
                    isSelected
                      ? 'text-brand-700 dark:text-nord-frost2'
                      : 'text-slate-500 dark:text-nord-muted'
                  }`}
                >
                  {profile.primaryStandard.title} • действует с {profile.effectiveFrom}
                </p>
                <p
                  className={`text-[11px] mt-1 ${isSelected ? 'text-brand-700 dark:text-nord-frost2/80' : 'text-slate-500'}`}
                >
                  {[profile.primaryStandard, ...profile.documentStandards]
                    .map((std) => std.id.toUpperCase())
                    .join(' • ')}
                </p>
              </button>
            );
          })}
        </div>
      </div>

      <div className={`${PANEL_CLASS} space-y-3`}>
        <div>
          <h4 className="text-sm font-bold text-brand-700 dark:text-nord-frost2 uppercase tracking-wider">
            Документ комплекта
          </h4>
          <p className="text-xs text-slate-600 dark:text-nord-4 mt-1">
            Состав и обозначения документов взяты из выбранного профиля ({activeProfile.name}).
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {documentCards.map((item) => {
            const isSelected = docType === item.docType;
            return (
              <button
                key={item.docType}
                type="button"
                onClick={() => onDocTypeChange(item.docType)}
                aria-pressed={isSelected}
                className={`p-4 rounded-xl border text-left transition-all ${
                  isSelected
                    ? 'bg-brand-600 border-brand-500 text-white font-bold shadow-xl shadow-brand-600/20 ring-2 ring-brand-200'
                    : 'bg-white dark:bg-nord-1 border-slate-200 dark:border-nord-3 text-slate-700 dark:text-nord-4 hover:border-slate-300 hover:bg-slate-50 dark:hover:bg-nord-3'
                }`}
              >
                <div className="flex items-center justify-between mb-1 gap-2">
                  <span className="font-bold text-sm">{item.uiTitle}</span>
                  <span
                    className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded whitespace-nowrap ${
                      isSelected
                        ? 'bg-white text-blue-700'
                        : 'bg-slate-100 dark:bg-nord-3 text-brand-700 dark:text-nord-frost2 border border-slate-300 dark:border-nord-3'
                    }`}
                  >
                    {item.standardCitation}
                  </span>
                </div>
                <p
                  className={`text-xs mt-2 leading-relaxed ${
                    isSelected
                      ? 'text-brand-700 dark:text-nord-frost2'
                      : 'text-slate-500 dark:text-nord-muted'
                  }`}
                >
                  {item.uiDescription}
                </p>
              </button>
            );
          })}
        </div>
      </div>

      <div className={`${PANEL_CLASS} space-y-3`}>
        <div>
          <h4 className="text-sm font-bold text-brand-700 dark:text-nord-frost2 uppercase tracking-wider">
            Оформление документа
          </h4>
          <p className="text-xs text-slate-600 dark:text-nord-4 mt-1">
            Рамка по ГОСТ 2.301-68 (20 мм слева, 5 мм с прочих сторон) и основные надписи форм 2 /
            2а по ГОСТ 2.104-2006.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5">
          {LAYOUT_PROFILE_CARDS.map((profile) => {
            const isSelected = layoutProfileId === profile.id;
            return (
              <button
                key={profile.id}
                type="button"
                onClick={() => onLayoutProfileChange(profile.id)}
                aria-pressed={isSelected}
                className={`p-3 rounded-xl border text-left transition-all ${
                  isSelected
                    ? 'bg-brand-600 border-brand-500 text-white shadow-lg shadow-brand-600/20 ring-1 ring-brand-200'
                    : 'bg-white dark:bg-nord-1 border-slate-200 dark:border-nord-3 text-slate-700 dark:text-nord-4 hover:border-slate-300 hover:bg-slate-50 dark:hover:bg-nord-3'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-bold text-xs">{profile.name}</span>
                  {profile.showEskdFrames && (
                    <span
                      className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                        isSelected
                          ? 'bg-white text-blue-700'
                          : 'bg-slate-100 dark:bg-nord-3 text-brand-700 dark:text-nord-frost2 border border-slate-300 dark:border-nord-3'
                      }`}
                    >
                      рамка
                    </span>
                  )}
                </div>
                <p
                  className={`text-[11px] mt-1.5 leading-relaxed ${
                    isSelected
                      ? 'text-brand-700 dark:text-nord-frost2'
                      : 'text-slate-500 dark:text-nord-muted'
                  }`}
                >
                  {profile.description}
                </p>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
