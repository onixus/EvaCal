import { DocumentBuildContext } from '../types';
import { ContextGap, ProjectContext } from '../../context/types';
import { CitationKey } from '../../standards/types';

/** Обозначение стандарта из профиля документа — по смыслу ссылки, а не по номеру. */
export function cite(c: DocumentBuildContext, key: CitationKey): string {
  return c.payload.standardProfile.citations[key];
}

/** Пробелы контекста, относящиеся к перечисленным полям. */
export function gapsFor(context: ProjectContext, prefixes: string[]): ContextGap[] {
  return (context.gaps || []).filter((g) =>
    prefixes.some((p) => g.path === p || g.path.startsWith(`${p}.`) || g.path.startsWith(`${p}[`)),
  );
}

export function listOrGap(values: string[] | undefined, label: string): string[] {
  return values && values.length > 0 ? [`${label}: ${values.join('; ')}.`] : [];
}

export const DEPLOYMENT_LABELS: Record<string, string> = {
  'on-premise': 'размещение на инфраструктуре Заказчика',
  cloud: 'размещение в облачной инфраструктуре',
  hybrid: 'гибридное размещение',
  unknown: 'уточняется',
};

export const DIRECTION_LABELS: Record<string, string> = {
  inbound: 'приём данных',
  outbound: 'передача данных',
  bidirectional: 'двусторонний обмен',
  unknown: 'уточняется',
};

export const SEVERITY_LABELS: Record<string, string> = {
  blocking: 'блокирующее',
  major: 'существенное',
  minor: 'несущественное',
};
