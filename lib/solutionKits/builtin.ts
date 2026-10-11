/**
 * Встроенные наборы решений (#103 WP-7a): статические отраслевые пресеты
 * (`lib/presets/*`) и шаблоны ТЗ (`lib/gost34/torTemplates/*`) в виде
 * содержимого первой версии набора. Чистые функции — без БД; запись делает
 * `seedBuiltinSolutionKits` в `./seed.ts`.
 *
 * Идентификаторы элементов детерминированы (`field-<key>`, `stage-01`,
 * `risk-01`, id требования шаблона ТЗ, `chk-<id требования>`, `frag-…`),
 * поэтому повторная сборка даёт то же содержимое, а последующие версии,
 * скопированные из v1, сохраняют `elementId`.
 */
import { INDUSTRY_PRESETS, type IndustryPreset } from '@/lib/presets/industryPresets';
import { GOST34_TOR_TEMPLATES, type Gost34TorTemplate } from '@/lib/gost34/torTemplates';
import { KIT_CONTENT_SCHEMA_VERSION, type KitScope, type SolutionKitContent } from './content';

export interface BuiltinKit {
  key: string;
  name: string;
  source: string;
  scope: KitScope;
  content: SolutionKitContent;
  changelog: string;
}

const PRESET_CATEGORY_LABELS: Record<IndustryPreset['category'], string> = {
  security: 'Информационная безопасность',
  hardware_pac: 'Оборудование и ПАК',
  compliance: 'КИИ и соответствие (ФСТЭК)',
  development: 'Заказная разработка',
  migration: 'Импортозамещение и миграции',
  monitoring: 'SIEM и мониторинг ИБ',
  infrastructure: 'Резервное копирование и инфраструктура',
};

const pad = (n: number) => String(n).padStart(2, '0');
const fieldElementId = (key: string) => `field-${key}`;
const stripPrefix = (id: string, prefix: string) =>
  (id.startsWith(prefix) ? id.slice(prefix.length) : id).toLowerCase();

export function presetKit(preset: IndustryPreset): BuiltinKit {
  const fields = [...preset.fields].sort((a, b) => a.order - b.order);
  const stages = [...preset.stageTemplates].sort((a, b) => a.order - b.order);
  const risks = [...preset.riskTemplates].sort((a, b) => a.order - b.order);
  return {
    key: `preset.${stripPrefix(preset.id, 'preset-')}`,
    name: preset.name,
    source: `preset:${preset.id}`,
    scope: {
      industries: [PRESET_CATEGORY_LABELS[preset.category] ?? preset.category],
      productTypes: [],
      notes: preset.description,
    },
    changelog: `Импорт отраслевого пресета ${preset.id} (lib/presets).`,
    content: {
      schemaVersion: KIT_CONTENT_SCHEMA_VERSION,
      fields: fields.map((f) => ({
        elementId: fieldElementId(f.key),
        key: f.key,
        label: f.label,
        type: f.type,
        options: f.options ?? [],
        required: f.required,
      })),
      requirements: [],
      stages: stages.map((s, i) => ({
        elementId: `stage-${pad(i + 1)}`,
        name: s.name,
        role: s.role,
        baseHours: s.baseHours,
        hoursPerUnit: s.hoursPerUnit,
        driver: s.driverFieldKey ? fieldElementId(s.driverFieldKey) : null,
        notes: s.requirements?.trim() || null,
        requirementIds: [],
      })),
      risks: risks.map((r, i) => ({
        elementId: `risk-${pad(i + 1)}`,
        description: r.description,
        hours: r.hours,
        stageIds: [],
        requirementIds: [],
      })),
      checks: [],
      fragments: [],
    },
  };
}

export function torTemplateKit(tpl: Gost34TorTemplate): BuiltinKit {
  const fragments: SolutionKitContent['fragments'] = [];
  if (tpl.metadata?.scopeSummary?.trim()) {
    fragments.push({
      elementId: 'frag-scope',
      sectionKey: 'tz2020-goals-purpose',
      title: 'Область применения',
      text: tpl.metadata.scopeSummary.trim(),
      requirementIds: [],
    });
  }
  if (tpl.metadata?.applicableStandards?.length) {
    fragments.push({
      elementId: 'frag-standards',
      sectionKey: 'tz2020-sources',
      title: 'Применимые стандарты',
      text: tpl.metadata.applicableStandards.join('\n'),
      requirementIds: [],
    });
  }
  return {
    key: `tor.${stripPrefix(tpl.id, 'tor-')}`,
    name: `Шаблон ТЗ: ${tpl.shortName}`,
    source: `tor-template:${tpl.id}`,
    scope: {
      industries: [tpl.categoryLabel],
      productTypes: [tpl.systemType],
      notes: tpl.description,
    },
    changelog: `Импорт шаблона ТЗ ${tpl.id} (lib/gost34/torTemplates).`,
    content: {
      schemaVersion: KIT_CONTENT_SCHEMA_VERSION,
      fields: [],
      requirements: tpl.requirements.map((r) => ({
        elementId: r.id,
        code: r.code || null,
        category: r.category,
        title: r.title,
        description: r.description,
        criterion: r.criterion?.trim() || null,
      })),
      stages: [],
      risks: [],
      // Критерий приёмки требования — отдельная проверка со ссылкой на него.
      // Метод в шаблоне не задан и не выдумывается: его выбирает владелец набора.
      checks: tpl.requirements
        .filter((r) => r.criterion?.trim())
        .map((r) => ({
          elementId: `chk-${r.id}`,
          requirementIds: [r.id],
          criteria: r.criterion!.trim(),
          method: null,
        })),
      fragments,
    },
  };
}

/** Все встроенные наборы в порядке отображения: пресеты, затем шаблоны ТЗ. */
export function builtinKits(): BuiltinKit[] {
  return [...INDUSTRY_PRESETS.map(presetKit), ...GOST34_TOR_TEMPLATES.map(torTemplateKit)];
}
