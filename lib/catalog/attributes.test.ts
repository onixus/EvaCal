import { describe, expect, it } from 'vitest';
import {
  attributeDefinitionInput,
  attributeFlags,
  checkAttributes,
  type AttributeDefinition,
} from './attributes';

const def = (patch: Partial<AttributeDefinition>): AttributeDefinition => ({
  id: patch.key ?? 'd',
  key: 'ram',
  label: 'Оперативная память',
  valueType: 'number',
  unit: 'ГБ',
  allowedUnits: ['ГБ', 'ТБ'],
  enumValues: null,
  archived: false,
  revision: 1,
  ...patch,
});
const definitions = [
  def({}),
  def({ id: 'ha', key: 'ha', label: 'HA', valueType: 'boolean', unit: null, allowedUnits: null }),
  def({
    id: 'form',
    key: 'form',
    label: 'Форм-фактор',
    valueType: 'enum',
    unit: null,
    allowedUnits: null,
    enumValues: ['1U', '2U'],
  }),
  def({ id: 'old', key: 'old', label: 'Old', archived: true }),
];

describe('Справочник характеристик', () => {
  it('число и единица из допустимых проходят; ключ и название сопоставляются без регистра', () => {
    expect(
      checkAttributes(
        [
          { name: 'RAM', value: '512', unit: 'ГБ' },
          { name: 'оперативная память', value: '1,5', unit: 'ТБ' },
        ],
        definitions,
      ),
    ).toEqual({ errors: [], unknown: [] });
  });
  it('нечисловое значение и недопустимая единица дают ошибки', () => {
    const { errors } = checkAttributes(
      [
        { name: 'ram', value: 'много', unit: 'ГБ' },
        { name: 'ram', value: '16', unit: 'МБ' },
        { name: 'ram', value: '16', unit: '' },
      ],
      definitions,
    );
    expect(errors).toHaveLength(3);
    expect(errors[0]).toMatch(/требуется число/);
    expect(errors[1]).toMatch(/не входит в допустимые/);
  });
  it('логические и перечисляемые значения проверяются', () => {
    expect(
      checkAttributes(
        [
          { name: 'HA', value: 'да', unit: '' },
          { name: 'form', value: '2u', unit: '' },
        ],
        definitions,
      ).errors,
    ).toEqual([]);
    const { errors } = checkAttributes(
      [
        { name: 'HA', value: 'возможно', unit: '' },
        { name: 'form', value: '3U', unit: '' },
      ],
      definitions,
    );
    expect(errors).toHaveLength(2);
  });
  it('неизвестные и архивные характеристики разрешены, но отмечаются', () => {
    const result = checkAttributes(
      [
        { name: 'EPS', value: '2000', unit: 'событий/с' },
        { name: 'old', value: 'x', unit: '' },
      ],
      definitions,
    );
    expect(result).toEqual({ errors: [], unknown: ['EPS', 'old'] });
    expect(attributeFlags([{ name: 'EPS', value: '1', unit: '' }], definitions)).toEqual([
      'Без справочника характеристик: EPS',
    ]);
  });
  it('определение валидируется', () => {
    expect(
      attributeDefinitionInput({
        key: 'ram',
        label: 'RAM',
        valueType: 'number',
        unit: 'ГБ',
        allowedUnits: ['ГБ', 'ТБ'],
      }),
    ).toMatchObject({ unit: 'ГБ', allowedUnits: ['ГБ', 'ТБ'], enumValues: null });
    expect(() => attributeDefinitionInput({ key: 'f', label: 'F', valueType: 'enum' })).toThrow(
      /перечня/,
    );
    expect(() =>
      attributeDefinitionInput({
        key: 'ram',
        label: 'RAM',
        valueType: 'number',
        unit: 'МБ',
        allowedUnits: ['ГБ'],
      }),
    ).toThrow(/по умолчанию/);
    expect(() =>
      attributeDefinitionInput({ key: 'x', label: 'X', valueType: 'boolean', unit: 'шт' }),
    ).toThrow();
    expect(() => attributeDefinitionInput({ key: 'x', label: 'X', valueType: 'date' })).toThrow();
    expect(() =>
      attributeDefinitionInput({
        key: 'u',
        label: 'U',
        valueType: 'number',
        allowedUnits: ['ГБ', 'гб'],
      }),
    ).toThrow(/уникальными/);
  });
});
