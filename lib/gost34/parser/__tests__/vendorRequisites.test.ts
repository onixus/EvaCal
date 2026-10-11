import { describe, it, expect } from 'vitest';
import { extractVendorRequisites } from '../vendorDocParser';

describe('extractVendorRequisites', () => {
  const text = `
      Операционная система Astra Linux Special Edition.
      Соответствие подтверждено сертификатом ФСТЭК России № 2557 (1 уровень доверия).
      Продукт включён в Единый реестр российского ПО, запись № 369.
      СКЗИ сертифицировано ФСБ России, сертификат № СФ/124-4900 (класс КС3).
    `;
  it('извлекает сертификаты ФСТЭК, ФСБ и записи реестра без статического справочника', () => {
    const found = extractVendorRequisites(text);
    expect(found.map((r) => [r.kind, r.number])).toEqual([
      ['fstek', '№ 2557'],
      ['fsb', '№ СФ/124-4900'],
      ['reestr-min-tsifry', '№ 369'],
    ]);
    // Без подтверждений каталога ничего не помечается как известное.
    expect(found.every((r) => r.matchesEvidenceId === undefined)).toBe(true);
  });

  it('совпадение номера с подтверждением каталога только помечается для пересверки', () => {
    const found = extractVendorRequisites(text, [
      { id: 'ev-1', number: '369' },
      { id: 'ev-2', number: '№ СФ/124-4900' },
    ]);
    expect(found.find((r) => r.kind === 'reestr-min-tsifry')?.matchesEvidenceId).toBe('ev-1');
    expect(found.find((r) => r.kind === 'fsb')?.matchesEvidenceId).toBe('ev-2');
    expect(found.find((r) => r.kind === 'fstek')?.matchesEvidenceId).toBeUndefined();
  });

  it('не дублирует одинаковые находки и терпит пустой текст', () => {
    const found = extractVendorRequisites(
      'сертификат ФСТЭК № 4063. Повторно: сертификат ФСТЭК России № 4063.',
    );
    expect(found).toHaveLength(1);
    expect(extractVendorRequisites('')).toEqual([]);
  });
});
