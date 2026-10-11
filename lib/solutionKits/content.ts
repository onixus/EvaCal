/**
 * Содержимое версии набора проектного решения (#103 WP-7a) и его проверка.
 *
 * Версия набора — это «требования + работы + риски + проверки + фрагменты
 * документов» и поля опросника, которые служат драйверами трудоёмкости этапов.
 * Каждый элемент несёт стабильный `elementId`, уникальный в пределах всей
 * версии; перекрёстные ссылки — только по `elementId` и только в разрешённый
 * раздел (проверка ссылается на требование, риск — на этап или требование…).
 * Новая версия копирует элементы предыдущей вместе с их `elementId`, поэтому
 * применённый к проекту элемент (следующий шаг #103) сохраняет происхождение
 * `{ kitId, version, elementId }` и сопоставим с новой версией набора.
 *
 * Проверка двухуровневая:
 * - `parseKitContent` — форма: типы, обязательные поля, неотрицательные часы.
 *   Нарушение формы не даёт сохранить черновик (400).
 * - `validateKitContent` — целостность: уникальность `elementId` и ключей
 *   полей, разрешение ссылок, отсутствие висячих ссылок. Черновик с такими
 *   замечаниями сохраняется, но утвердить его нельзя (409).
 */
import { ROLES } from '@/lib/roles';

export const KIT_CONTENT_SCHEMA_VERSION = 1;

/** Ключ набора; совпадает с CHECK `SolutionKit_key_check` в миграции. */
export const KIT_KEY_PATTERN = /^[a-z0-9][a-z0-9._-]{1,99}$/;
/** Стабильный идентификатор элемента версии. */
export const ELEMENT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/;
/** Ключ поля опросника (как `FormField.key`). */
export const FIELD_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;

/** Методы проверки — те же, что у проверок приёмки (`AcceptanceCheck.method`). */
export const KIT_CHECK_METHODS = ['INSPECTION', 'ANALYSIS', 'DEMONSTRATION', 'TEST'] as const;
export type KitCheckMethod = (typeof KIT_CHECK_METHODS)[number];

export const KIT_FIELD_TYPES = [
  'text',
  'number',
  'select',
  'checkbox',
  'textarea',
  'complexity',
] as const;
export type KitFieldType = (typeof KIT_FIELD_TYPES)[number];

export const KIT_STAGE_ROLES: readonly string[] = ROLES.map((r) => r.value);

export const KIT_SECTIONS = [
  'fields',
  'requirements',
  'stages',
  'risks',
  'checks',
  'fragments',
] as const;
export type KitSection = (typeof KIT_SECTIONS)[number];

export const KIT_SECTION_LABELS: Record<KitSection, string> = {
  fields: 'Поля опросника',
  requirements: 'Требования',
  stages: 'Работы (этапы)',
  risks: 'Риски',
  checks: 'Проверки',
  fragments: 'Фрагменты документов',
};

export interface KitField {
  elementId: string;
  key: string;
  label: string;
  type: KitFieldType;
  options: string[];
  required: boolean;
}

export interface KitRequirement {
  elementId: string;
  code: string | null;
  category: string;
  title: string;
  description: string;
  criterion: string | null;
}

export interface KitStage {
  elementId: string;
  name: string;
  role: string;
  baseHours: number;
  hoursPerUnit: number;
  /** elementId числового поля-драйвера; null — норматив без драйвера. */
  driver: string | null;
  notes: string | null;
  requirementIds: string[];
}

export interface KitRisk {
  elementId: string;
  description: string;
  hours: number;
  stageIds: string[];
  requirementIds: string[];
}

export interface KitCheck {
  elementId: string;
  /** Требования, которые проверка подтверждает; хотя бы одно. */
  requirementIds: string[];
  criteria: string;
  method: KitCheckMethod | null;
}

export interface KitFragment {
  elementId: string;
  /** Раздел документа (id или заголовок раздела комплекта ГОСТ 34). */
  sectionKey: string;
  title: string | null;
  text: string;
  requirementIds: string[];
}

export interface SolutionKitContent {
  schemaVersion: typeof KIT_CONTENT_SCHEMA_VERSION;
  fields: KitField[];
  requirements: KitRequirement[];
  stages: KitStage[];
  risks: KitRisk[];
  checks: KitCheck[];
  fragments: KitFragment[];
}

export type KitElement = KitField | KitRequirement | KitStage | KitRisk | KitCheck | KitFragment;

export interface KitContentIssue {
  /** JSON-путь к месту ошибки, например `checks[2].requirementIds[0]`. */
  path: string;
  code:
    | 'shape'
    | 'invalid-element-id'
    | 'duplicate-element-id'
    | 'duplicate-field-key'
    | 'duplicate-ref'
    | 'dangling-ref'
    | 'wrong-ref-section'
    | 'driver-not-number'
    | 'check-without-requirement';
  message: string;
  elementId?: string;
}

/** Провенанс элемента, применённого к проекту (#103 7.3, следующий шаг). */
export interface KitElementProvenance {
  kitId: string;
  kitKey: string;
  kitVersion: number;
  elementId: string;
}

export function emptyKitContent(): SolutionKitContent {
  return {
    schemaVersion: KIT_CONTENT_SCHEMA_VERSION,
    fields: [],
    requirements: [],
    stages: [],
    risks: [],
    checks: [],
    fragments: [],
  };
}

// ── Форма ────────────────────────────────────────────────────────────────

const MAX_TEXT = 20_000;
const MAX_ELEMENTS_PER_SECTION = 2_000;
const MAX_HOURS = 100_000;

class ShapeReader {
  issues: KitContentIssue[] = [];

  fail(path: string, message: string) {
    this.issues.push({ path, code: 'shape', message });
  }

  obj(value: unknown, path: string): Record<string, unknown> | null {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }
    this.fail(path, 'ожидается объект');
    return null;
  }

  text(o: Record<string, unknown>, key: string, path: string): string {
    const v = o[key];
    if (typeof v !== 'string' || !v.trim()) {
      this.fail(`${path}.${key}`, 'обязательная непустая строка');
      return '';
    }
    if (v.length > MAX_TEXT) this.fail(`${path}.${key}`, `не длиннее ${MAX_TEXT} символов`);
    return v.trim();
  }

  optText(o: Record<string, unknown>, key: string, path: string): string | null {
    const v = o[key];
    if (v === undefined || v === null) return null;
    if (typeof v !== 'string') {
      this.fail(`${path}.${key}`, 'строка или null');
      return null;
    }
    if (v.length > MAX_TEXT) this.fail(`${path}.${key}`, `не длиннее ${MAX_TEXT} символов`);
    return v.trim() || null;
  }

  hours(o: Record<string, unknown>, key: string, path: string, fallback?: number): number {
    const v = o[key] ?? fallback;
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > MAX_HOURS) {
      this.fail(`${path}.${key}`, `число от 0 до ${MAX_HOURS}`);
      return 0;
    }
    return v;
  }

  ids(o: Record<string, unknown>, key: string, path: string): string[] {
    const v = o[key];
    if (v === undefined || v === null) return [];
    if (!Array.isArray(v) || v.some((x) => typeof x !== 'string')) {
      this.fail(`${path}.${key}`, 'массив строк (elementId)');
      return [];
    }
    return (v as string[]).map((x) => x.trim());
  }

  list(root: Record<string, unknown>, key: KitSection): unknown[] {
    const v = root[key];
    if (v === undefined || v === null) return [];
    if (!Array.isArray(v)) {
      this.fail(key, 'ожидается массив');
      return [];
    }
    if (v.length > MAX_ELEMENTS_PER_SECTION) {
      this.fail(key, `не больше ${MAX_ELEMENTS_PER_SECTION} элементов`);
      return [];
    }
    return v;
  }
}

function elementIdOf(r: ShapeReader, o: Record<string, unknown>, path: string): string {
  const v = o.elementId;
  if (typeof v !== 'string' || !v.trim()) {
    r.fail(`${path}.elementId`, 'обязательный elementId');
    return '';
  }
  return v.trim();
}

/**
 * Разбор формы содержимого. Возвращает каноническое содержимое (лишние ключи
 * отброшены, умолчания заполнены) либо null и список ошибок формы.
 */
export function parseKitContent(raw: unknown): {
  content: SolutionKitContent | null;
  issues: KitContentIssue[];
} {
  const r = new ShapeReader();
  const root = r.obj(raw, '$');
  if (!root) return { content: null, issues: r.issues };
  if (root.schemaVersion !== undefined && root.schemaVersion !== KIT_CONTENT_SCHEMA_VERSION) {
    r.fail('schemaVersion', `поддерживается только версия схемы ${KIT_CONTENT_SCHEMA_VERSION}`);
  }

  const fields: KitField[] = [];
  r.list(root, 'fields').forEach((item, i) => {
    const path = `fields[${i}]`;
    const o = r.obj(item, path);
    if (!o) return;
    const type = o.type;
    if (typeof type !== 'string' || !(KIT_FIELD_TYPES as readonly string[]).includes(type)) {
      r.fail(`${path}.type`, `одно из: ${KIT_FIELD_TYPES.join(', ')}`);
    }
    const key = r.text(o, 'key', path);
    if (key && !FIELD_KEY_PATTERN.test(key)) {
      r.fail(`${path}.key`, 'латиница, цифры и _; начинается с буквы или _');
    }
    const options = o.options;
    if (
      options !== undefined &&
      options !== null &&
      (!Array.isArray(options) || options.some((x) => typeof x !== 'string'))
    ) {
      r.fail(`${path}.options`, 'массив строк');
    }
    if (o.required !== undefined && typeof o.required !== 'boolean') {
      r.fail(`${path}.required`, 'true или false');
    }
    fields.push({
      elementId: elementIdOf(r, o, path),
      key,
      label: r.text(o, 'label', path),
      type: type as KitFieldType,
      options: Array.isArray(options) ? (options as string[]) : [],
      required: o.required === true,
    });
  });

  const requirements: KitRequirement[] = [];
  r.list(root, 'requirements').forEach((item, i) => {
    const path = `requirements[${i}]`;
    const o = r.obj(item, path);
    if (!o) return;
    requirements.push({
      elementId: elementIdOf(r, o, path),
      code: r.optText(o, 'code', path),
      category: r.text(o, 'category', path),
      title: r.text(o, 'title', path),
      description: r.text(o, 'description', path),
      criterion: r.optText(o, 'criterion', path),
    });
  });

  const stages: KitStage[] = [];
  r.list(root, 'stages').forEach((item, i) => {
    const path = `stages[${i}]`;
    const o = r.obj(item, path);
    if (!o) return;
    const role = r.text(o, 'role', path);
    if (role && !KIT_STAGE_ROLES.includes(role)) {
      r.fail(`${path}.role`, `одна из ролей: ${KIT_STAGE_ROLES.join(', ')}`);
    }
    const driver = o.driver;
    if (driver !== undefined && driver !== null && typeof driver !== 'string') {
      r.fail(`${path}.driver`, 'elementId поля или null');
    }
    stages.push({
      elementId: elementIdOf(r, o, path),
      name: r.text(o, 'name', path),
      role,
      baseHours: r.hours(o, 'baseHours', path),
      hoursPerUnit: r.hours(o, 'hoursPerUnit', path, 0),
      driver: typeof driver === 'string' && driver.trim() ? driver.trim() : null,
      notes: r.optText(o, 'notes', path),
      requirementIds: r.ids(o, 'requirementIds', path),
    });
  });

  const risks: KitRisk[] = [];
  r.list(root, 'risks').forEach((item, i) => {
    const path = `risks[${i}]`;
    const o = r.obj(item, path);
    if (!o) return;
    risks.push({
      elementId: elementIdOf(r, o, path),
      description: r.text(o, 'description', path),
      hours: r.hours(o, 'hours', path, 0),
      stageIds: r.ids(o, 'stageIds', path),
      requirementIds: r.ids(o, 'requirementIds', path),
    });
  });

  const checks: KitCheck[] = [];
  r.list(root, 'checks').forEach((item, i) => {
    const path = `checks[${i}]`;
    const o = r.obj(item, path);
    if (!o) return;
    const method = o.method;
    if (
      method !== undefined &&
      method !== null &&
      !(KIT_CHECK_METHODS as readonly unknown[]).includes(method)
    ) {
      r.fail(`${path}.method`, `одно из: ${KIT_CHECK_METHODS.join(', ')} или null`);
    }
    checks.push({
      elementId: elementIdOf(r, o, path),
      requirementIds: r.ids(o, 'requirementIds', path),
      criteria: r.text(o, 'criteria', path),
      method: (KIT_CHECK_METHODS as readonly unknown[]).includes(method)
        ? (method as KitCheckMethod)
        : null,
    });
  });

  const fragments: KitFragment[] = [];
  r.list(root, 'fragments').forEach((item, i) => {
    const path = `fragments[${i}]`;
    const o = r.obj(item, path);
    if (!o) return;
    fragments.push({
      elementId: elementIdOf(r, o, path),
      sectionKey: r.text(o, 'sectionKey', path),
      title: r.optText(o, 'title', path),
      text: r.text(o, 'text', path),
      requirementIds: r.ids(o, 'requirementIds', path),
    });
  });

  if (r.issues.length > 0) return { content: null, issues: r.issues };
  return {
    content: {
      schemaVersion: KIT_CONTENT_SCHEMA_VERSION,
      fields,
      requirements,
      stages,
      risks,
      checks,
      fragments,
    },
    issues: [],
  };
}

// ── Целостность ──────────────────────────────────────────────────────────

/** Все элементы версии с разделом и позицией — для индексов и диффа. */
export function kitElements(
  content: SolutionKitContent,
): { section: KitSection; index: number; element: KitElement }[] {
  return KIT_SECTIONS.flatMap((section) =>
    (content[section] as KitElement[]).map((element, index) => ({ section, index, element })),
  );
}

/**
 * Проверка целостности разобранного содержимого. Пустой список — версию можно
 * утверждать.
 */
export function validateKitContent(content: SolutionKitContent): KitContentIssue[] {
  const issues: KitContentIssue[] = [];
  const owner = new Map<string, KitSection>();

  for (const { section, index, element } of kitElements(content)) {
    const path = `${section}[${index}].elementId`;
    const id = element.elementId;
    if (!ELEMENT_ID_PATTERN.test(id)) {
      issues.push({
        path,
        code: 'invalid-element-id',
        message: 'elementId: латиница, цифры и . _ : -, до 100 символов',
        elementId: id,
      });
    }
    const seen = owner.get(id);
    if (seen) {
      issues.push({
        path,
        code: 'duplicate-element-id',
        message: `elementId «${id}» уже занят в разделе «${KIT_SECTION_LABELS[seen]}»`,
        elementId: id,
      });
    } else {
      owner.set(id, section);
    }
  }

  const keys = new Set<string>();
  content.fields.forEach((f, i) => {
    if (keys.has(f.key)) {
      issues.push({
        path: `fields[${i}].key`,
        code: 'duplicate-field-key',
        message: `ключ поля «${f.key}» повторяется`,
        elementId: f.elementId,
      });
    }
    keys.add(f.key);
  });

  const refs = (
    section: KitSection,
    index: number,
    from: KitElement,
    key: string,
    ids: string[],
    target: KitSection,
  ) => {
    const dup = new Set<string>();
    ids.forEach((id, j) => {
      const path = `${section}[${index}].${key}[${j}]`;
      if (dup.has(id)) {
        issues.push({
          path,
          code: 'duplicate-ref',
          message: `ссылка на «${id}» повторяется`,
          elementId: from.elementId,
        });
        return;
      }
      dup.add(id);
      const actual = owner.get(id);
      if (!actual) {
        issues.push({
          path,
          code: 'dangling-ref',
          message: `элемент «${id}» не найден (раздел «${KIT_SECTION_LABELS[target]}»)`,
          elementId: from.elementId,
        });
      } else if (actual !== target) {
        issues.push({
          path,
          code: 'wrong-ref-section',
          message: `«${id}» — элемент раздела «${KIT_SECTION_LABELS[actual]}», ожидается «${KIT_SECTION_LABELS[target]}»`,
          elementId: from.elementId,
        });
      }
    });
  };

  const fieldById = new Map(content.fields.map((f) => [f.elementId, f]));
  content.stages.forEach((s, i) => {
    refs('stages', i, s, 'requirementIds', s.requirementIds, 'requirements');
    if (s.driver !== null) {
      refs('stages', i, s, 'driver', [s.driver], 'fields');
      const field = fieldById.get(s.driver);
      if (field && field.type !== 'number' && owner.get(s.driver) === 'fields') {
        issues.push({
          path: `stages[${i}].driver`,
          code: 'driver-not-number',
          message: `поле-драйвер «${field.key}» должно быть числовым`,
          elementId: s.elementId,
        });
      }
    }
  });
  content.risks.forEach((r, i) => {
    refs('risks', i, r, 'stageIds', r.stageIds, 'stages');
    refs('risks', i, r, 'requirementIds', r.requirementIds, 'requirements');
  });
  content.checks.forEach((c, i) => {
    if (c.requirementIds.length === 0) {
      issues.push({
        path: `checks[${i}].requirementIds`,
        code: 'check-without-requirement',
        message: 'проверка должна ссылаться хотя бы на одно требование',
        elementId: c.elementId,
      });
    }
    refs('checks', i, c, 'requirementIds', c.requirementIds, 'requirements');
  });
  content.fragments.forEach((f, i) => {
    refs('fragments', i, f, 'requirementIds', f.requirementIds, 'requirements');
  });

  return issues;
}

/** Разбор формы и проверка целостности за один вызов. */
export function checkKitContent(raw: unknown): {
  content: SolutionKitContent | null;
  shapeIssues: KitContentIssue[];
  issues: KitContentIssue[];
} {
  const parsed = parseKitContent(raw);
  if (!parsed.content) return { content: null, shapeIssues: parsed.issues, issues: [] };
  return { content: parsed.content, shapeIssues: [], issues: validateKitContent(parsed.content) };
}

/** Сводка по разделам: сколько элементов в каждом. */
export function kitContentStats(content: SolutionKitContent): Record<KitSection, number> {
  return Object.fromEntries(KIT_SECTIONS.map((s) => [s, content[s].length])) as Record<
    KitSection,
    number
  >;
}

// ── Паспорт набора ──────────────────────────────────────────────────────

export interface KitScope {
  industries: string[];
  productTypes: string[];
  notes: string;
}

const MAX_SCOPE_ITEMS = 50;

/** Нормализация области применимости; null — форма неверна. */
export function parseKitScope(raw: unknown): KitScope | null {
  if (raw === undefined || raw === null) return { industries: [], productTypes: [], notes: '' };
  if (typeof raw !== 'object' || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const list = (v: unknown): string[] | null => {
    if (v === undefined || v === null) return [];
    if (!Array.isArray(v) || v.some((x) => typeof x !== 'string')) return null;
    const items = [...new Set((v as string[]).map((x) => x.trim()).filter(Boolean))];
    return items.length > MAX_SCOPE_ITEMS ? null : items;
  };
  const industries = list(o.industries);
  const productTypes = list(o.productTypes);
  if (!industries || !productTypes) return null;
  if (o.notes !== undefined && o.notes !== null && typeof o.notes !== 'string') return null;
  const notes = typeof o.notes === 'string' ? o.notes.trim() : '';
  if (notes.length > MAX_TEXT) return null;
  return { industries, productTypes, notes };
}
