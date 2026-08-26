import { NextRequest, NextResponse } from 'next/server';
import { requireStaff } from '@/lib/access';
import { handleApiError } from '@/lib/apiHelpers';
import { loadCalculationForExport } from '@/lib/export';
import { buildWizardReview } from '@/lib/gost34/wizard';
import { getManagedAgent, parseModes } from '@/lib/gost34/agents/registry';
import { invokeHarnessAgent } from '@/lib/gost34/agents/invoke';
import { isHarnessAgentMode } from '@/lib/gost34/agents/types';

type Params = { params: Promise<{ id: string }> };

/**
 * Запуск харнесс-агента.
 *
 * Режимы:
 *  - `ping` — проверка связи, комплект не отправляется;
 *  - `review` / `enrichment` — по calculationId сервер сам собирает результат
 *    мастера ревью (требования, применимость, трассировка, сводка) и передаёт
 *    его агенту. Ответ агента возвращается клиенту нормализованным; патчи
 *    обогащения ничего не меняют без явного применения человеком.
 */
export async function POST(req: NextRequest, { params }: Params) {
  try {
    const session = await requireStaff();
    if (session instanceof NextResponse) return session;

    const { id } = await params;
    const agent = await getManagedAgent(id, session.userId, session.role === 'admin');
    if (!agent) return NextResponse.json({ error: 'Агент не найден' }, { status: 404 });
    if (!agent.enabled) {
      return NextResponse.json({ error: 'Агент выключен' }, { status: 400 });
    }

    const body = await req.json().catch(() => ({}));
    const mode = body?.mode;

    if (mode === 'ping') {
      const result = await invokeHarnessAgent(agent, 'ping', { hello: 'evacal' });
      return NextResponse.json({ result });
    }

    if (!isHarnessAgentMode(mode)) {
      return NextResponse.json(
        { error: 'mode должен быть review, enrichment или ping' },
        { status: 400 },
      );
    }
    if (!parseModes(agent.modes).includes(mode)) {
      return NextResponse.json({ error: `Агент не подключён к режиму «${mode}»` }, { status: 400 });
    }

    const calculationId = body?.calculationId;
    if (!calculationId) {
      return NextResponse.json({ error: 'calculationId is required' }, { status: 400 });
    }
    const calculation = await loadCalculationForExport(String(calculationId));
    if (!calculation) {
      return NextResponse.json({ error: 'Расчёт не найден' }, { status: 404 });
    }

    const review = buildWizardReview({
      calculation: calculation as any,
      rawRequirements: body?.rawRequirements || [],
      vendorFiles: body?.vendorFiles || [],
      standardProfileId: body?.standardProfileId,
      applicabilityOverrides: body?.applicabilityOverrides,
      manualLinks: body?.manualLinks || [],
      projectContext: body?.projectContext,
    });

    const result = await invokeHarnessAgent(agent, mode, {
      calculationId,
      review,
    });
    return NextResponse.json({ result });
  } catch (err) {
    return handleApiError(err, 'Не удалось запустить агента');
  }
}
