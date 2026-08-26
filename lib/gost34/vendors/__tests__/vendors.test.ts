import { describe, it, expect } from 'vitest';
import { VENDOR_HARDWARE, VENDOR_SOFTWARE } from '../registry';
import {
  buildVendorMatchText,
  findVendorHardware,
  findVendorSoftware,
  quantityFromRule,
  registryLine,
} from '../match';

describe('База знаний вендоров РФ', () => {
  it('не содержит дубликатов идентификаторов', () => {
    const ids = [...VENDOR_SOFTWARE, ...VENDOR_HARDWARE].map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('каждый номер реестра/сертификата подтверждён источником', () => {
    for (const p of VENDOR_SOFTWARE) {
      const hasNumber = /№ ?\d/.test(`${p.reestrMinTsifry || ''} ${p.certification || ''}`);
      if (hasNumber) {
        expect(p.sourceUrl, `${p.id}: номер без ссылки на источник`).toBeTruthy();
      }
    }
  });

  it('находит продукты по проектному контексту пресейла', () => {
    const text = buildVendorMatchText(
      ['Межсетевые экраны NGFW UserGate', 'СКЗИ ViPNet Coordinator HW (ГОСТ-VPN)'],
      { ngfw_clusters_count: 2 },
      'Контур ИБ',
    );
    const found = findVendorSoftware(text).map((p) => p.id);
    expect(found).toContain('usergate-ngfw');
    expect(found).toContain('vipnet');

    const hw = findVendorHardware(text).map((p) => p.id);
    expect(hw).toContain('usergate-appliance');
    expect(hw).toContain('vipnet-coordinator-hw');
  });

  it('не даёт ложных срабатываний на общих словах', () => {
    const text = buildVendorMatchText(
      ['Веб-приложение документооборота'],
      { comment: 'посредство предоставления' },
      'Портал',
    );
    expect(findVendorSoftware(text).map((p) => p.id)).not.toContain('red-os');
    expect(findVendorSoftware(text).map((p) => p.id)).not.toContain('kaspersky-kuma');
  });

  it('считает количество по правилу и ответам опросника', () => {
    const rule = {
      answerKey: 'db_clusters_count',
      multiplier: 2,
      unit: 'узла',
      fallback: '2 узла',
    };
    expect(quantityFromRule(rule, { db_clusters_count: 3 })).toBe('6 узла');
    expect(quantityFromRule(rule, {})).toBe('2 узла');
    expect(quantityFromRule(undefined, {})).toBe('1 компл.');
  });

  it('формирует строку реестра без выдуманных номеров', () => {
    const withNumber = VENDOR_SOFTWARE.find((p) => p.id === 'astra-linux-se')!;
    expect(registryLine(withNumber)).toContain('№ 369');

    const withoutNumber = VENDOR_SOFTWARE.find((p) => !p.reestrMinTsifry)!;
    expect(registryLine(withoutNumber)).toBe('Единый реестр российского ПО (188-ФЗ)');
  });
});
