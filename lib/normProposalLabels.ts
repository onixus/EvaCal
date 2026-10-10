/** Подписи предложений нормативов (#103 WP-6c) для клиента: без node:crypto. */
import type { NormConfidence, NormSkipReason } from './normProposals';

export const CONFIDENCE_LABELS: Record<NormConfidence, string> = {
  low: 'низкая',
  medium: 'средняя',
  high: 'высокая',
};

export const SKIP_REASON_LABELS: Record<NormSkipReason, string> = {
  'ambiguous-template': 'в шаблоне несколько этапов с тем же именем и ролью',
  'negative-norm': 'норматив этапа отрицательный — исправьте его в формуле этапа',
  'no-samples': 'нет завершённых этапов в выигранных проектах',
  'no-complete-samples': 'ни у одного завершённого этапа нет факта (или ответа-драйвера)',
  'zero-formula': 'у всех полных наблюдений формула норматива даёт 0 ч — коэффициент не определён',
  'within-tolerance': 'факт совпадает с нормативом в пределах допуска',
  'rejected-same-data': 'предложение по тем же данным уже отклонено',
};
