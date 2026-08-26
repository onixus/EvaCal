import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireCalcAccess } from '@/lib/access';
import { handleApiError } from '@/lib/apiHelpers';
import { pmHoursFor, primaryStagesFromTemplate, scheduleConfigFromTemplate } from '@/lib/calc';
import { expandWithApprovals, scheduleItems, totalLaborHours } from '@/lib/scheduling';
import { calculateCommercialSummary } from '@/lib/commercial';
import { roleLabel } from '@/lib/roles';

/**
 * Предварительная оценка по ответам опросника — без записи в БД.
 *
 * Живая сводка пресейла показывает трудозатраты по мере заполнения, поэтому
 * считать нужно теми же движками, что и при создании расчёта: иначе цифра в
 * сводке разошлась бы с цифрой в созданном расчёте.
 */
export async function POST(req: NextRequest) {
  try {
    const access = await requireCalcAccess(req, null, ['create']);
    if (access instanceof NextResponse) return access;

    const body = await req.json();
    const templateId = String(body?.templateId ?? '');
    const answers = (body?.answers ?? {}) as Record<string, unknown>;

    if (!templateId) {
      return NextResponse.json({ error: 'templateId обязателен' }, { status: 400 });
    }

    const template = await prisma.formTemplate.findUnique({
      where: { id: templateId },
      include: {
        fields: { orderBy: { order: 'asc' } },
        stageTemplates: { orderBy: { order: 'asc' } },
        riskTemplates: { orderBy: { order: 'asc' } },
      },
    });
    if (!template) {
      return NextResponse.json({ error: 'Шаблон не найден' }, { status: 404 });
    }

    const primary = primaryStagesFromTemplate(template.stageTemplates, answers);
    const pmHours = pmHoursFor(template.fields, answers, primary);

    const startDate = body?.startDate ? new Date(body.startDate) : new Date();
    const config = scheduleConfigFromTemplate(template);
    const scheduled = scheduleItems(expandWithApprovals(primary), startDate, config);

    const stageHours = totalLaborHours(scheduled);
    const riskHours = template.riskTemplates.reduce((sum, r) => sum + r.hours, 0);
    const totalHours = stageHours + pmHours + riskHours;

    // Календарная длительность — от первой даты старта до последней даты
    // окончания, включая задачи согласования: пресейлу важен срок для Заказчика,
    // а не сумма трудозатрат.
    const calendarDays =
      scheduled.length === 0
        ? 0
        : Math.max(
            1,
            Math.round(
              (Math.max(...scheduled.map((s) => s.endDate.getTime())) -
                Math.min(...scheduled.map((s) => s.startDate.getTime()))) /
                86_400_000,
            ) + 1,
          );

    const commercial = calculateCommercialSummary(
      scheduled.map((s) => ({ role: s.role, hours: s.hours, isApprovalTask: s.isApprovalTask })),
      pmHours,
      template.riskTemplates.map((r) => ({ hours: r.hours })),
      {},
    );

    const roles = new Set(scheduled.filter((s) => !s.isApprovalTask).map((s) => s.role));

    // Опросник считается заполненным по непустым ответам на его поля —
    // прогресс-бар на шаге 2 показывает именно это отношение.
    const answeredCount = template.fields.filter((f) => {
      const value = answers[f.key];
      return value !== undefined && value !== null && String(value).trim() !== '';
    }).length;

    return NextResponse.json({
      totalHours: Math.round(totalHours * 10) / 10,
      stageCount: scheduled.filter((s) => !s.isApprovalTask).length,
      calendarDays,
      roleCount: roles.size,
      currency: commercial.currency,
      currencySymbol: commercial.currencySymbol,
      priceTotal: commercial.grandTotal,
      fieldCount: template.fields.length,
      answeredCount,
      stages: scheduled.map((s) => ({
        name: s.name,
        role: s.role,
        roleLabel: roleLabel(s.role),
        hours: Math.round(s.hours * 10) / 10,
        days: Math.max(
          1,
          Math.round((s.endDate.getTime() - s.startDate.getTime()) / 86_400_000) + 1,
        ),
        isApprovalTask: s.isApprovalTask,
      })),
    });
  } catch (err) {
    return handleApiError(err, 'Failed to preview estimate', 500);
  }
}
