/**
 * Schema-driven описание структуры документа (Этап 2 плана модернизации).
 *
 * Структура документа задаётся деревом узлов, а не массивом статических
 * строк: нумерация, порядок и обязательность разделов вычисляются
 * рендерером, а содержимое каждого раздела строится из ProjectContext
 * и модели требований.
 *
 * Обозначения стандартов схема не хранит — они берутся из нормативного
 * профиля (`lib/gost34/standards`), приходящего в payload.
 */

import { Gost34InputPayload, Gost34Section, Gost34TableData } from '../types';
import { ContextGap, ProjectContext } from '../context/types';

/** Содержимое одного раздела, возвращаемое build-функцией узла схемы. */
export interface SectionContent {
  /** Ненумерованные абзацы (вводный текст раздела). */
  paragraphs?: string[];
  /** Пункты раздела; нумеруются рендерером как `<номер раздела>.<n>`. */
  items?: string[];
  tables?: Gost34TableData[];
  /** Пробелы контекста, попавшие в этот раздел. */
  gaps?: ContextGap[];
}

export interface DocumentBuildContext {
  payload: Gost34InputPayload;
  context: ProjectContext;
  schema: DocumentSchema;
}

export interface SchemaNode {
  id: string;
  title: string;
  /** Обязательный раздел профиля: проверяется валидатором структуры. */
  required?: boolean;
  /** Раздел оформляется как приложение (нумерация «Приложение А», «Приложение Б»). */
  appendix?: boolean;
  /** Раздел включается в документ только при выполнении условия. */
  includeWhen?: (c: DocumentBuildContext) => boolean;
  build?: (c: DocumentBuildContext) => SectionContent;
  children?: SchemaNode[];
}

export interface DocumentSchema {
  id: string;
  /** Идентификатор нормативного профиля, которому принадлежит схема. */
  profileId: string;
  nodes: SchemaNode[];
}

/** Результат проверки соответствия построенного документа схеме. */
export interface SchemaValidationIssue {
  nodeId: string;
  title: string;
  kind: 'missing' | 'empty' | 'out-of-order';
  message: string;
}

export type RenderedSections = Gost34Section[];
