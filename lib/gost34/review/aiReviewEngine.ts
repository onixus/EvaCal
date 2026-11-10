import { resolveLlmProvider } from '@/lib/gost34/llm/providers';
import { chatCompletion } from '@/lib/gost34/llm/client';
import { SectionComment } from '@/lib/gost34/review/types';

export interface AuditDocumentInput {
  docType: string;
  documentTitle: string;
  sections: Array<{ id: string; title: string; content: string }>;
  providerId?: string;
  model?: string;
}

export interface AiReviewFinding {
  sectionId: string;
  severity: 'blocker' | 'remark' | 'suggestion';
  text: string;
  clauseRef?: string;
}

export interface AiReviewReport {
  ok: boolean;
  providerId: string;
  model: string;
  summary: string;
  findings: AiReviewFinding[];
  durationMs: number;
}

const GROK_REVIEW_SYSTEM_PROMPT = `Ты — ведущий эксперт по нормоконтролю, техническому надзору и аудиту нормативно-технической документации по стандартам ГОСТ 34 (ГОСТ 34.602-2020, ГОСТ 34.201-2020) и РД 50-34.698-90.
Твоя задача — провести критический аудит предоставленных разделов комплекта документации.

Анализируй на:
1. Противоречия и галлюцинации (неподтвержденные цифры, выдуманные требования, несоответствие статусов обязательности «должна» / «может»).
2. Нарушение требований ГОСТ 34 (отсутствие обязательных атрибутов, неполнота описания требований, размытые критерии приемки).
3. Пробелы в логике архитектуры (упущенные интеграции, отсутствие требований безопасности, резервирования и отказоустойчивости).

Классифицируй находки по severity:
- "blocker": критическое несоответствие ГОСТ 34, ложные обязательства, отсутствие критических разделов, нарушение безопасности/КИИ.
- "remark": некорректная терминология, размытые формулировки, отсутствие конкретных метрик SLA/RTO/RPO.
- "suggestion": стилевые улучшения, форматирование, рекомендации по структуре.

Отвечай строго в формате JSON:
{
  "summary": "Краткое общее резюме аудита документа",
  "findings": [
    {
      "sectionId": "идентификатор раздела",
      "severity": "blocker" | "remark" | "suggestion",
      "text": "Четкое описание замечания и рекомендация по исправлению",
      "clauseRef": "ссылка на пункт ГОСТ или документа, если применимо"
    }
  ]
}`;

export async function runGrokDocumentReview(input: AuditDocumentInput): Promise<AiReviewReport> {
  const started = Date.now();
  // По умолчанию выбираем провайдер для ревью (Grok / cloud-grok или fallback)
  const provider = resolveLlmProvider(input.providerId || 'cloud-grok');
  const model = input.model || provider.defaultModel || 'grok-2-latest';

  const userPrompt = `Проведи строгий аудит документа:
Тип документа: ${input.docType}
Название: ${input.documentTitle}

Разделы документа:
${input.sections
  .map(
    (s) => `--- Раздел ID: ${s.id} | Заголовок: ${s.title} ---
${s.content.slice(0, 4000)}`,
  )
  .join('\n\n')}

Верни результаты аудита строго в виде JSON согласно схеме.`;

  const completion = await chatCompletion({
    provider,
    model,
    messages: [
      { role: 'system', content: GROK_REVIEW_SYSTEM_PROMPT },
      { role: 'user', content: userPrompt },
    ],
    temperature: 0.1,
    responseFormat: 'json',
  });

  let parsed: any;
  try {
    parsed = JSON.parse(completion.text);
  } catch {
    const jsonMatch = completion.text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      parsed = JSON.parse(jsonMatch[0]);
    } else {
      throw new Error('Модель вернула некорректный JSON при аудите ревью');
    }
  }

  const findings: AiReviewFinding[] = (Array.isArray(parsed?.findings) ? parsed.findings : [])
    .slice(0, 100)
    .map((f: any) => ({
      sectionId: String(f?.sectionId || input.sections[0]?.id || 'general').slice(0, 100),
      severity:
        f?.severity === 'blocker' || f?.severity === 'remark' || f?.severity === 'suggestion'
          ? f.severity
          : 'remark',
      text: String(f?.text || '')
        .trim()
        .slice(0, 2000),
      clauseRef: f?.clauseRef ? String(f.clauseRef).trim().slice(0, 200) : undefined,
    }))
    .filter((f: AiReviewFinding) => f.text.length > 0);

  return {
    ok: true,
    providerId: provider.id,
    model: completion.model,
    summary: String(parsed?.summary || 'Аудит успешно выполнен.')
      .trim()
      .slice(0, 1000),
    findings,
    durationMs: Date.now() - started,
  };
}
