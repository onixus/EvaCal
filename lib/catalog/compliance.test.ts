import { describe, expect, it } from 'vitest';
import {
  applicabilityMatches,
  deriveEvidenceStatus,
  evidenceInput,
  evidenceText,
  itemEvidence,
  NOT_CONFIRMED,
  parseEvidenceSnapshot,
  type EvidenceSnapshot,
} from './compliance';
import { parseSpecification } from '../specification/validation';

const input = {
  type: 'software_registry',
  number: '369',
  issuer: 'Минцифры России',
  sourceUrl: 'https://reestr.digital.gov.ru/reestr/369/',
  checkedAt: '2026-10-01',
  validUntil: null,
  status: 'confirmed',
  applicability: 'SE 1.8; SE 1.7',
  note: '',
};
const snapshot = (patch: Partial<EvidenceSnapshot> = {}): EvidenceSnapshot => ({
  id: 'ev-1',
  productId: 'p',
  productRevision: 1,
  type: 'software_registry',
  number: '369',
  issuer: 'Минцифры России',
  sourceUrl: 'https://reestr.digital.gov.ru/reestr/369/',
  checkedAt: '2026-10-01',
  checkedBy: 'u1',
  validUntil: null,
  status: 'confirmed',
  applicability: 'SE 1.8',
  ...patch,
});

describe('Ввод подтверждения соответствия', () => {
  it('принимает запись реестра с источником, датой и применимостью', () => {
    expect(evidenceInput(input, '2026-10-10')).toMatchObject({
      type: 'software_registry',
      number: '369',
      checkedAt: '2026-10-01',
      validUntil: null,
    });
  });
  it.each([
    [{ sourceUrl: 'ftp://x' }, /http/],
    [{ sourceUrl: 'не ссылка' }, /http/],
    [{ checkedAt: '2026-13-01' }, /ГГГГ-ММ-ДД/],
    [{ checkedAt: '2026-10-11' }, /будущем/],
    [{ applicability: ' ; ' }, /версию/],
    [{ applicability: '' }, /Применимость/],
    [{ number: '' }, /Номер/],
    [{ type: 'brand' }, /тип/],
    [{ status: 'ok' }, /статус/],
  ])('отклоняет %o', (patch, message) => {
    expect(() => evidenceInput({ ...input, ...patch }, '2026-10-10')).toThrow(message);
  });
});

describe('Производный статус', () => {
  it('подтверждено, пока срок не истек и проверка свежая', () => {
    expect(deriveEvidenceStatus(snapshot(), '2026-10-10', 365).status).toBe('confirmed');
    expect(
      deriveEvidenceStatus(snapshot({ validUntil: '2026-10-10' }), '2026-10-10', 365).status,
    ).toBe('confirmed');
  });
  it('истекший срок (по деловой дате) → expired', () => {
    expect(
      deriveEvidenceStatus(snapshot({ validUntil: '2026-10-09' }), '2026-10-10', 365),
    ).toMatchObject({ status: 'expired', reason: expect.stringContaining('2026-10-09') });
  });
  it('устаревшая проверка → unverified; отозванное и непроверенное не подтверждаются', () => {
    expect(deriveEvidenceStatus(snapshot(), '2026-11-01', 30)).toMatchObject({
      status: 'unverified',
      reason: expect.stringMatching(/устарела/),
    });
    expect(deriveEvidenceStatus(snapshot({ status: 'revoked' }), '2026-10-10').status).toBe(
      'revoked',
    );
    expect(deriveEvidenceStatus(snapshot({ status: 'unverified' }), '2026-10-10').status).toBe(
      'unverified',
    );
    expect(deriveEvidenceStatus(snapshot({ status: 'expired' }), '2026-10-10').status).toBe(
      'expired',
    );
  });
});

describe('Применимость и печать', () => {
  it('точное совпадение версии/модели/SKU без учета регистра', () => {
    expect(applicabilityMatches('SE 1.8; SE 1.7', ['se 1.7'])).toBe(true);
    expect(applicabilityMatches('SE 1.8', ['SE 1.8.1', 'SE'])).toBe(false);
    expect(applicabilityMatches('SE 1.8', ['', undefined])).toBe(false);
  });
  const row = {
    confirmed: true,
    sku: 'ALSE-18',
    origin: { sku: 'ALSE-18', edition: 'SE 1.8' },
  };
  it('печатается только действующее подтверждение подтвержденной позиции', () => {
    const view = itemEvidence({ ...row, evidence: [snapshot()] }, '2026-10-10', 365);
    expect(view.current).toHaveLength(1);
    expect(evidenceText(view)).toMatch(
      /Реестр российского ПО № 369.*SE 1\.8.*проверено 2026-10-01/,
    );
  });
  it('иначе «Не подтверждено» с причинами', () => {
    const cases = [
      itemEvidence({ ...row, confirmed: false, evidence: [snapshot()] }, '2026-10-10', 365),
      itemEvidence(
        { ...row, evidence: [snapshot({ applicability: 'SE 1.7' })] },
        '2026-10-10',
        365,
      ),
      itemEvidence(
        { ...row, evidence: [snapshot({ validUntil: '2026-01-01' })] },
        '2026-10-10',
        365,
      ),
      itemEvidence({ ...row, evidence: [snapshot()] }, '2028-01-01', 365),
      itemEvidence(row, '2026-10-10', 365),
    ];
    for (const view of cases) expect(evidenceText(view)).toBe(NOT_CONFIRMED);
    expect(cases[1].problems[0]).toMatch(/не относится/);
    expect(cases[2].problems[0]).toMatch(/истек/);
    expect(cases[3].problems[0]).toMatch(/устарела/);
    expect(cases[4].problems[0]).toMatch(/не внесены/);
  });
});

describe('Снимок в редакции спецификации', () => {
  it('строго проверяется при загрузке', () => {
    expect(parseEvidenceSnapshot(snapshot())).toEqual(snapshot());
    expect(() => parseEvidenceSnapshot({ ...snapshot(), extra: 1 })).toThrow(/Неизвестное/);
    expect(() => parseEvidenceSnapshot({ ...snapshot(), status: 'ok' })).toThrow();
    const spec = parseSpecification({
      version: 1,
      status: 'draft',
      emptySupplyReason: '',
      items: [
        {
          id: 'r',
          kind: 'software',
          disposition: 'supply',
          name: 'ОС',
          vendor: 'V',
          sku: 'ALSE-18',
          quantity: '1',
          unit: 'шт.',
          configuration: '',
          licensing: 'OEM',
          term: '',
          source: 's',
          rationale: 'r',
          confirmed: true,
          unitPrice: null,
          currency: 'RUB',
          evidence: [snapshot()],
        },
      ],
    });
    expect(spec.items[0].evidence).toEqual([snapshot()]);
  });
});
