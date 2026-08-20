import { describe, it, expect } from 'vitest';
import {
  formatTableCaption,
  sanitizeDocText,
  splitNumberedClause,
  stripTableCaptionPrefix,
  toHeadingCase,
} from '../textFormat';

describe('Правила оформления текста документа', () => {
  it('не оставляет букву «ё» в тексте', () => {
    expect(sanitizeDocText('Трудоёмкость и приёмка')).toBe('Трудоемкость и приемка');
    expect(sanitizeDocText('Ёмкость')).toBe('Емкость');
  });

  it('не даёт разрывать обозначение стандарта переносом строки', () => {
    expect(sanitizeDocText('в соответствии с ГОСТ Р 59793-2021.')).toBe(
      'в соответствии с ГОСТ Р 59793-2021.',
    );
    expect(sanitizeDocText('ГОСТ 34.602-2020')).toBe('ГОСТ 34.602-2020');
    expect(sanitizeDocText('Приказ № 117')).toBe('Приказ № 117');
  });

  it('печатает заголовки строчными буквами с прописной, сохраняя аббревиатуры', () => {
    expect(toHeadingCase('ОБЩИЕ СВЕДЕНИЯ')).toBe('Общие сведения');
    expect(toHeadingCase('ЦЕЛИ И НАЗНАЧЕНИЕ СОЗДАНИЯ (РАЗВИТИЯ) АС')).toBe(
      'Цели и назначение создания (развития) АС',
    );
    expect(toHeadingCase('СОСТАВ И СОДЕРЖАНИЕ РАБОТ ПО СОЗДАНИЮ АС')).toBe(
      'Состав и содержание работ по созданию АС',
    );
    // «ПО» вне позиции предлога — аббревиатура программного обеспечения
    expect(toHeadingCase('СПЕЦИФИКАЦИЯ ОБОРУДОВАНИЯ И ПО')).toBe('Спецификация оборудования и ПО');
    // Заголовок со строчными буквами уже оформлен и не меняется
    expect(toHeadingCase('Цели создания АС')).toBe('Цели создания АС');
  });

  it('оформляет наименование таблицы по ГОСТ 2.105', () => {
    expect(formatTableCaption('1', 'Спецификация требований к системе')).toBe(
      'Т а б л и ц а 1 – Спецификация требований к системе',
    );
    expect(formatTableCaption('А.1', 'Перечень сведений')).toBe(
      'Т а б л и ц а А.1 – Перечень сведений',
    );
  });

  it('снимает ручной префикс «Таблица» из исходных данных', () => {
    expect(stripTableCaptionPrefix('Таблица — Матрица прослеживаемости')).toBe(
      'Матрица прослеживаемости',
    );
    expect(stripTableCaptionPrefix('Таблица 2 — Состав работ')).toBe('Состав работ');
    expect(stripTableCaptionPrefix('Состав работ')).toBe('Состав работ');
  });

  it('выделяет номер нумерованного пункта', () => {
    expect(splitNumberedClause('1.3 Обозначение документа: АБВГ.')).toEqual({
      number: '1.3',
      rest: 'Обозначение документа: АБВГ.',
    });
    expect(splitNumberedClause('Обычный абзац текста.')).toBeNull();
  });
});
