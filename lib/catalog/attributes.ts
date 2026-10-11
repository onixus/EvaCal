// Client-safe typed attribute definitions. A product attribute whose name matches a
// definition key or label (case-insensitive) must satisfy that definition; attributes
// without a definition stay allowed and are only flagged for review.
import { SpecificationError } from '../specification/validation';
import { object, text } from './validation';
import type { Attribute } from './types';

export const ATTRIBUTE_VALUE_TYPES = ['text', 'number', 'boolean', 'enum'] as const;
export type AttributeValueType = (typeof ATTRIBUTE_VALUE_TYPES)[number];
export const ATTRIBUTE_TYPE_LABELS: Record<AttributeValueType, string> = {
  text: 'Текст',
  number: 'Число',
  boolean: 'Да/нет',
  enum: 'Перечень',
};
export interface AttributeDefinitionInput {
  key: string;
  label: string;
  valueType: AttributeValueType;
  /** Default unit; null when the value has no unit. */
  unit: string | null;
  /** Accepted units; null means only `unit` (or any unit when `unit` is null). */
  allowedUnits: string[] | null;
  enumValues: string[] | null;
}
export interface AttributeDefinition extends AttributeDefinitionInput {
  id: string;
  archived: boolean;
  revision: number;
}

function list(value: unknown, field: string, max: number): string[] | null {
  if (value === null || value === undefined) return null;
  if (!Array.isArray(value) || value.length > max)
    throw new SpecificationError(`${field}: список до ${max} значений`);
  const items = value.map((v) => text(v, field, 100, true));
  if (new Set(items.map((v) => v.toLowerCase())).size !== items.length)
    throw new SpecificationError(`${field}: значения должны быть уникальными`);
  return items.length ? items : null;
}

export function attributeDefinitionInput(input: unknown): AttributeDefinitionInput {
  const d = object(input);
  const key = text(d.key, 'Ключ характеристики', 100, true);
  if (!/^[\p{L}\p{N}_.\- ]+$/u.test(key))
    throw new SpecificationError('Ключ: буквы, цифры, пробел, «_», «-», «.»');
  if (!(ATTRIBUTE_VALUE_TYPES as readonly unknown[]).includes(d.valueType))
    throw new SpecificationError('Некорректный тип значения характеристики');
  const valueType = d.valueType as AttributeValueType;
  const unit =
    d.unit === null || d.unit === undefined || d.unit === '' ? null : text(d.unit, 'Единица', 30);
  const allowedUnits = list(d.allowedUnits, 'Допустимые единицы', 30);
  const enumValues = list(d.enumValues, 'Значения перечня', 100);
  if (valueType === 'enum' && !enumValues)
    throw new SpecificationError('Для перечня задайте допустимые значения');
  if (valueType !== 'enum' && enumValues)
    throw new SpecificationError('Значения перечня задаются только для типа «Перечень»');
  if (unit && allowedUnits && !allowedUnits.includes(unit))
    throw new SpecificationError('Единица по умолчанию должна входить в допустимые');
  if (valueType === 'boolean' && (unit || allowedUnits))
    throw new SpecificationError('Логическая характеристика не имеет единицы');
  return {
    key,
    label: text(d.label, 'Название характеристики', 100, true),
    valueType,
    unit,
    allowedUnits,
    enumValues,
  };
}

const BOOLEAN_VALUES = ['да', 'нет', 'true', 'false', 'yes', 'no'];
const NUMBER = /^-?\d+(?:[.,]\d+)?$/;

export function findDefinition(definitions: AttributeDefinition[], name: string) {
  const key = name.trim().toLowerCase();
  return definitions.find(
    (d) => !d.archived && (d.key.toLowerCase() === key || d.label.toLowerCase() === key),
  );
}

/** Errors for one attribute against its definition (empty when valid). */
export function attributeErrors(definition: AttributeDefinition, attribute: Attribute): string[] {
  const errors: string[] = [];
  const name = attribute.name;
  const value = attribute.value.trim();
  if (definition.valueType === 'number' && !NUMBER.test(value.replace(/\s/g, '')))
    errors.push(`${name}: требуется число, получено «${attribute.value}»`);
  if (definition.valueType === 'boolean' && !BOOLEAN_VALUES.includes(value.toLowerCase()))
    errors.push(`${name}: требуется «да» или «нет»`);
  if (
    definition.valueType === 'enum' &&
    !(definition.enumValues ?? []).some((v) => v.toLowerCase() === value.toLowerCase())
  )
    errors.push(`${name}: значение вне перечня (${(definition.enumValues ?? []).join(', ')})`);
  const allowed = definition.allowedUnits ?? (definition.unit ? [definition.unit] : null);
  if (definition.valueType === 'boolean' || definition.valueType === 'enum') {
    if (attribute.unit && !(allowed ?? []).includes(attribute.unit))
      errors.push(`${name}: единица не предусмотрена`);
  } else if (allowed && !allowed.includes(attribute.unit))
    errors.push(
      `${name}: единица «${attribute.unit || 'не задана'}» не входит в допустимые (${allowed.join(', ')})`,
    );
  return errors;
}

/** Validation result: `errors` block a manual save, `unknown` lists flagged attributes. */
export function checkAttributes(attributes: Attribute[], definitions: AttributeDefinition[]) {
  const errors: string[] = [];
  const unknown: string[] = [];
  for (const attribute of attributes) {
    const definition = findDefinition(definitions, attribute.name);
    if (!definition) unknown.push(attribute.name);
    else errors.push(...attributeErrors(definition, attribute));
  }
  return { errors, unknown };
}

/** Human-readable flags shown next to a stored product (imports are flagged, not rejected). */
export function attributeFlags(attributes: Attribute[], definitions: AttributeDefinition[]) {
  const { errors, unknown } = checkAttributes(attributes, definitions);
  return [
    ...errors,
    ...(unknown.length ? [`Без справочника характеристик: ${unknown.join(', ')}`] : []),
  ];
}
