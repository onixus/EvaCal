import { SchemaNode, SectionContent } from '../types';
import { TZ_2020_SECTIONS } from '../tz34-2020-sections';
import { generateTraceabilityTable } from '../../traceability';

export const sectionWorkScope: SchemaNode = {
  id: 'tz2020-work-scope',
  title: TZ_2020_SECTIONS.workScope,
  required: true,
  build: ({ payload }): SectionContent => {
    const stages = payload.stages || [];
    const risks = payload.risks || [];
    const reqs = payload.customRequirements || [];

    const items = [
      'Перечень стадий и этапов работ, их содержание и трудоёмкость приведены в таблице настоящего раздела.',
    ];
    if (reqs.length > 0 && stages.length > 0) {
      items.push('Соответствие требований этапам работ приведено в матрице прослеживаемости.');
    }
    if (risks.length > 0) {
      items.push('Резерв трудозатрат на отработку рисков проекта приведён отдельной таблицей.');
    }

    const tables = [];
    if (stages.length > 0) {
      tables.push({
        caption: 'Состав и содержание работ по созданию системы',
        headers: ['Наименование этапа', 'Роль исполнителя', 'Трудоёмкость, ч', 'Содержание работ'],
        rows: stages.map((s) => [s.name, s.role, s.hours, s.requirements || '—']),
      });
    }
    if (reqs.length > 0 && stages.length > 0) {
      tables.push(generateTraceabilityTable(reqs, stages));
    }
    if (risks.length > 0) {
      tables.push({
        caption: 'Резерв трудозатрат на риски проекта',
        headers: ['№', 'Содержание риска', 'Резерв, ч'],
        rows: risks.map((r, idx) => [idx + 1, r.description, r.hours]),
      });
    }

    return { items, tables: tables.length > 0 ? tables : undefined };
  },
};
