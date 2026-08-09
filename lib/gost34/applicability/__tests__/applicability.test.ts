import { describe, it, expect } from 'vitest';
import {
  evaluateApplicability,
  evaluateStandardApplicability,
  getApplicabilitySummary,
  getApplicableStandards,
  getUnknownStandards,
  getNotApplicableStandards,
  toEnrichmentOptions,
} from '../engine';
import { getEnrichedGostRequirements } from '../../enricher';
import type { ProjectContext } from '../../context/types';

describe('Applicability Engine (PR-05)', () => {
  describe('Default and Empty Context', () => {
    it('evaluates empty context with UNKNOWN default and does not assume APPLICABLE', () => {
      const emptyContext: ProjectContext = {};
      const results = evaluateApplicability(emptyContext);

      expect(results.length).toBe(13);
      // All standards should be UNKNOWN (no false assumptions)
      expect(results.every((r) => r.calculatedStatus === 'UNKNOWN')).toBe(true);
      expect(results.every((r) => r.finalStatus === 'UNKNOWN')).toBe(true);

      const applicable = getApplicableStandards(results);
      expect(applicable).toHaveLength(0);

      const unknown = getUnknownStandards(results);
      expect(unknown).toHaveLength(13);

      const summary = getApplicabilitySummary(results);
      expect(summary.total).toBe(13);
      expect(summary.applicable).toBe(0);
      expect(summary.unknown).toBe(13);
      expect(summary.notApplicable).toBe(0);

      const options = toEnrichmentOptions(results);
      expect(Object.values(options).every((v) => v === false)).toBe(true);
    });

    it('returns empty requirements list when context is empty and no overrides given', () => {
      const emptyContext: ProjectContext = {};
      const reqs = getEnrichedGostRequirements(undefined, emptyContext);
      expect(reqs).toHaveLength(0);
    });
  });

  describe('Personal Data (152-ФЗ / Приказ ФСТЭК № 21)', () => {
    it('marks fstek_21 and fz_152 as APPLICABLE when personalDataProcessed is true', () => {
      const context: ProjectContext = {
        security: {
          personalDataProcessed: true,
        },
      };

      const results = evaluateApplicability(context);
      const fstek21 = results.find((r) => r.standardId === 'fstek_21');
      const fz152 = results.find((r) => r.standardId === 'fz_152');

      expect(fstek21?.finalStatus).toBe('APPLICABLE');
      expect(fstek21?.confidence).toBeGreaterThanOrEqual(0.9);
      expect(fstek21?.evidence.some((e) => e.source === 'security.personalDataProcessed')).toBe(true);

      expect(fz152?.finalStatus).toBe('APPLICABLE');
      expect(fz152?.confidence).toBeGreaterThanOrEqual(0.9);

      const reqs = getEnrichedGostRequirements(undefined, context);
      expect(reqs.some((r) => r.code === 'ТР-БЕЗ-21')).toBe(true);
      expect(reqs.some((r) => r.code === 'ТР-БЕЗ-152ФЗ')).toBe(true);
    });

    it('identifies personal data from dataClasses', () => {
      const context: ProjectContext = {
        dataClasses: [
          { name: 'Паспортные данные и ФИО пользователей', sensitivity: 'персональные данные' },
        ],
      };

      const fstek21 = evaluateStandardApplicability('fstek_21', context);
      expect(fstek21?.finalStatus).toBe('APPLICABLE');
      expect(fstek21?.evidence[0].source).toBe('dataClasses');
    });

    it('marks as NOT_APPLICABLE when personalDataProcessed is explicitly false', () => {
      const context: ProjectContext = {
        security: {
          personalDataProcessed: false,
        },
      };

      const fstek21 = evaluateStandardApplicability('fstek_21', context);
      const fz152 = evaluateStandardApplicability('fz_152', context);

      expect(fstek21?.finalStatus).toBe('NOT_APPLICABLE');
      expect(fz152?.finalStatus).toBe('NOT_APPLICABLE');
    });
  });

  describe('Critical Information Infrastructure (187-ФЗ, ФСТЭК № 239, ФСБ № 282)', () => {
    it('marks KII regulations as APPLICABLE when kiiObject is true', () => {
      const context: ProjectContext = {
        security: {
          kiiObject: true,
        },
      };

      const results = evaluateApplicability(context);
      const fz187 = results.find((r) => r.standardId === 'fz_187_kii');
      const fstek239 = results.find((r) => r.standardId === 'fstek_239');
      const fsb282 = results.find((r) => r.standardId === 'fsb_282_gossopka');

      expect(fz187?.finalStatus).toBe('APPLICABLE');
      expect(fstek239?.finalStatus).toBe('APPLICABLE');
      expect(fsb282?.finalStatus).toBe('APPLICABLE');

      const reqs = getEnrichedGostRequirements(undefined, context);
      expect(reqs.some((r) => r.code === 'ТР-БЕЗ-187ФЗ')).toBe(true);
      expect(reqs.some((r) => r.code === 'ТР-БЕЗ-239')).toBe(true);
      expect(reqs.some((r) => r.code === 'ТР-БЕЗ-282')).toBe(true);
    });

    it('detects KII domain from automationObject or domain description', () => {
      const context: ProjectContext = {
        automationObject: 'АСУ ТП энергетического комплекса субъекта КИИ',
      };

      const fz187 = evaluateStandardApplicability('fz_187_kii', context);
      expect(fz187?.finalStatus).toBe('APPLICABLE');
    });

    it('marks KII regulations as NOT_APPLICABLE when kiiObject is explicitly false', () => {
      const context: ProjectContext = {
        security: {
          kiiObject: false,
        },
      };

      const fz187 = evaluateStandardApplicability('fz_187_kii', context);
      const fstek239 = evaluateStandardApplicability('fstek_239', context);
      const fsb282 = evaluateStandardApplicability('fsb_282_gossopka', context);

      expect(fz187?.finalStatus).toBe('NOT_APPLICABLE');
      expect(fstek239?.finalStatus).toBe('NOT_APPLICABLE');
      expect(fsb282?.finalStatus).toBe('NOT_APPLICABLE');
    });
  });

  describe('Russian Software Registry (188-ФЗ)', () => {
    it('marks 188-ФЗ as APPLICABLE when importSubstitution is true', () => {
      const context: ProjectContext = {
        infrastructure: {
          importSubstitution: true,
        },
      };

      const fz188 = evaluateStandardApplicability('fz_188_reestr', context);
      expect(fz188?.finalStatus).toBe('APPLICABLE');
      expect(fz188?.confidence).toBeGreaterThanOrEqual(0.9);
    });

    it('detects Russian platforms from infrastructure.platforms', () => {
      const context: ProjectContext = {
        infrastructure: {
          platforms: ['Astra Linux Special Edition', 'Postgres Pro Enterprise'],
        },
      };

      const fz188 = evaluateStandardApplicability('fz_188_reestr', context);
      expect(fz188?.finalStatus).toBe('APPLICABLE');
      expect(fz188?.evidence.some((e) => e.source === 'infrastructure.platforms')).toBe(true);
    });

    it('marks 188-ФЗ as NOT_APPLICABLE when importSubstitution is false', () => {
      const context: ProjectContext = {
        infrastructure: {
          importSubstitution: false,
        },
      };

      const fz188 = evaluateStandardApplicability('fz_188_reestr', context);
      expect(fz188?.finalStatus).toBe('NOT_APPLICABLE');
    });
  });

  describe('Financial and Banking Standards (ГОСТ Р 57580, ЦБ 683-П, 757-П, 719-П)', () => {
    it('triggers credit organization rules for bank context', () => {
      const context: ProjectContext = {
        automationObject: 'Автоматизированная банковская система (АБС) кредитной организации',
        systemPurpose: 'Обработка платежей и расчетно-кассовое обслуживание',
      };

      const gost57580 = evaluateStandardApplicability('gost_57580', context);
      const cb683p = evaluateStandardApplicability('cb_683p', context);

      expect(gost57580?.finalStatus).toBe('APPLICABLE');
      expect(cb683p?.finalStatus).toBe('APPLICABLE');
    });

    it('triggers NFO rules for non-credit financial organizations', () => {
      const context: ProjectContext = {
        automationObject: 'Информационная система некредитной финансовой организации (НФО)',
        systemPurpose: 'Учет договоров страховой компании и микрофинансовой организации (МФО)',
      };

      const cb757p = evaluateStandardApplicability('cb_757p', context);
      expect(cb757p?.finalStatus).toBe('APPLICABLE');
    });

    it('triggers 719-П when antifraud and electronic signatures are required', () => {
      const context: ProjectContext = {
        systemPurpose: 'Проведение платежных поручений с использованием СКЗИ и двухфакторной электронной подписи, модуль антифрод',
      };

      const cb719p = evaluateStandardApplicability('cb_719p', context);
      expect(cb719p?.finalStatus).toBe('APPLICABLE');
    });
  });

  describe('SLA 99.9% and Reliability', () => {
    it('marks sla_999 as APPLICABLE when target availability >= 99.9%', () => {
      const context: ProjectContext = {
        availability: {
          availabilityTargetPercent: 99.95,
          rtoMinutes: 10,
          rpoMinutes: 2,
        },
      };

      const sla = evaluateStandardApplicability('sla_999', context);
      expect(sla?.finalStatus).toBe('APPLICABLE');
      expect(sla?.confidence).toBeGreaterThanOrEqual(0.9);
    });

    it('marks sla_999 as NOT_APPLICABLE when availability target is low and RTO is large', () => {
      const context: ProjectContext = {
        availability: {
          availabilityTargetPercent: 95.0,
          rtoMinutes: 120,
        },
      };

      const sla = evaluateStandardApplicability('sla_999', context);
      expect(sla?.finalStatus).toBe('NOT_APPLICABLE');
    });
  });

  describe('Web Accessibility (ГОСТ Р 52872-2019 / WCAG 2.1 AA)', () => {
    it('marks wcag_52872 as APPLICABLE when web components or citizen users exist', () => {
      const context: ProjectContext = {
        architecture: {
          components: ['Web-портал', 'API Gateway', 'База данных'],
        },
        users: [
          { name: 'Граждане и внешние клиенты', description: 'Подача заявлений через публичный веб-интерфейс' },
        ],
      };

      const wcag = evaluateStandardApplicability('wcag_52872', context);
      expect(wcag?.finalStatus).toBe('APPLICABLE');
    });

    it('marks wcag_52872 as NOT_APPLICABLE for headless service without UI', () => {
      const context: ProjectContext = {
        architecture: {
          style: 'headless daemon api-only',
          components: [],
        },
      };

      const wcag = evaluateStandardApplicability('wcag_52872', context);
      expect(wcag?.finalStatus).toBe('NOT_APPLICABLE');
    });
  });

  describe('Explicit Regulatory Scope', () => {
    it('gives confidence 1.0 when standard is explicitly listed in regulatoryScope', () => {
      const context: ProjectContext = {
        security: {
          regulatoryScope: ['fstek_21', 'fz_187', '57580'],
        },
      };

      const fstek21 = evaluateStandardApplicability('fstek_21', context);
      const fz187 = evaluateStandardApplicability('fz_187_kii', context);
      const gost57580 = evaluateStandardApplicability('gost_57580', context);

      expect(fstek21?.finalStatus).toBe('APPLICABLE');
      expect(fstek21?.confidence).toBe(1.0);

      expect(fz187?.finalStatus).toBe('APPLICABLE');
      expect(fz187?.confidence).toBe(1.0);

      expect(gost57580?.finalStatus).toBe('APPLICABLE');
      expect(gost57580?.confidence).toBe(1.0);
    });
  });

  describe('Human Overrides and Confirmations', () => {
    it('allows human confirmation to override UNKNOWN to APPLICABLE', () => {
      const emptyContext: ProjectContext = {};
      const results = evaluateApplicability(emptyContext, {
        fstek_21: {
          status: 'APPLICABLE',
          confirmedBy: 'Архитектор Иванов А.В.',
          reason: 'Согласовано с отделом информационной безопасности',
        },
      });

      const fstek21 = results.find((r) => r.standardId === 'fstek_21');
      expect(fstek21?.calculatedStatus).toBe('UNKNOWN');
      expect(fstek21?.finalStatus).toBe('APPLICABLE');
      expect(fstek21?.confirmedStatus).toBe('APPLICABLE');
      expect(fstek21?.confirmedBy).toBe('Архитектор Иванов А.В.');
      expect(fstek21?.overrideReason).toBe('Согласовано с отделом информационной безопасности');
    });

    it('supports boolean dictionary overrides', () => {
      const emptyContext: ProjectContext = {};
      const results = evaluateApplicability(emptyContext, {
        fstek_21: true,
        fstek_239: false,
      });

      const fstek21 = results.find((r) => r.standardId === 'fstek_21');
      const fstek239 = results.find((r) => r.standardId === 'fstek_239');
      const fz152 = results.find((r) => r.standardId === 'fz_152');

      expect(fstek21?.finalStatus).toBe('APPLICABLE');
      expect(fstek239?.finalStatus).toBe('NOT_APPLICABLE');
      expect(fz152?.finalStatus).toBe('UNKNOWN');
    });

    it('getNotApplicableStandards returns rejected standards', () => {
      const emptyContext: ProjectContext = {};
      const results = evaluateApplicability(emptyContext, {
        fz_187_kii: false,
      });

      const notApplicable = getNotApplicableStandards(results);
      expect(notApplicable.some((r) => r.standardId === 'fz_187_kii')).toBe(true);
    });
  });
});
