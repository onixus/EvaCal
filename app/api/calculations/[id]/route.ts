import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import {
  primaryStagesFromTemplate,
  rebuildStages,
  pmHoursFor,
  scheduleConfigFromTemplate,
} from '@/lib/calc';
import { requireCalcAccess, requireStaff } from '@/lib/access';
import { actorTypeFromAccess, clientIp, writeAudit } from '@/lib/audit';

export async function GET(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const access = await requireCalcAccess(req, params.id, ['read']);
  if (access instanceof NextResponse) return access;

  const calculation = await prisma.calculation.findUnique({
    where: { id: params.id },
    include: {
      template: {
        include: {
          fields: { orderBy: { order: 'asc' } },
          stageTemplates: { orderBy: { order: 'asc' } },
        },
      },
      stages: { orderBy: { order: 'asc' } },
      risks: { orderBy: { order: 'asc' } },
    },
  });
  if (!calculation) return NextResponse.json({ error: 'not found' }, { status: 404 });
  return NextResponse.json({
    ...calculation,
    answers: JSON.parse(calculation.answers),
  });
}

// Presale edits: name/customer/answers -> stages (and the derived РП hours) are regenerated
// from the template formulas. Per-stage requirements text is architect-only, so it's untouched here.
export async function PUT(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const access = await requireCalcAccess(req, params.id, ['write']);
  if (access instanceof NextResponse) return access;

  const body = await req.json();
  const existing = await prisma.calculation.findUnique({
    where: { id: params.id },
    include: { template: { include: { stageTemplates: true, fields: true } } },
  });
  if (!existing) return NextResponse.json({ error: 'not found' }, { status: 404 });
  if (existing.status === 'approved') {
    return NextResponse.json(
      { error: 'Расчёт уже утверждён и не может быть изменён' },
      { status: 409 },
    );
  }

  const answers = body.answers ?? JSON.parse(existing.answers);

  // A template default locks the start date for presale — the submitted value is ignored.
  const startDate =
    existing.template.defaultStartDate ??
    (body.startDate ? new Date(body.startDate) : existing.startDate);

  const primary = primaryStagesFromTemplate(existing.template.stageTemplates, answers);
  const pmHours = pmHoursFor(existing.template.fields, answers, primary);

  const roleRatesJson =
    body.roleRates !== undefined
      ? typeof body.roleRates === 'object'
        ? JSON.stringify(body.roleRates)
        : body.roleRates
      : existing.roleRates;

  const calculation = await prisma.calculation.update({
    where: { id: params.id },
    data: {
      name: body.name ?? existing.name,
      customer: body.customer ?? existing.customer,
      answers: JSON.stringify(answers),
      startDate,
      pmHours,
      status: existing.status === 'pending_approval' ? 'draft' : existing.status,
      currency: body.currency ?? existing.currency,
      roleRates: roleRatesJson,
      overheadPercent: body.overheadPercent !== undefined ? Number(body.overheadPercent) : existing.overheadPercent,
      marginPercent: body.marginPercent !== undefined ? Number(body.marginPercent) : existing.marginPercent,
      discountPercent: body.discountPercent !== undefined ? Number(body.discountPercent) : existing.discountPercent,
      vatPercent: body.vatPercent !== undefined ? Number(body.vatPercent) : existing.vatPercent,
      includeVat: body.includeVat !== undefined ? Boolean(body.includeVat) : existing.includeVat,
    },
  });

  await rebuildStages(
    calculation.id,
    primary,
    startDate,
    scheduleConfigFromTemplate(existing.template),
  );

  await writeAudit({
    actorType: actorTypeFromAccess(access.kind),
    actorId: access.actorId,
    action: 'calculation.update',
    entityType: 'calculation',
    entityId: params.id,
    ip: clientIp(req),
  });

  return NextResponse.json({ ok: true });
}

// Architect/admin override: bypasses the template-level lock on startDate
// and allows updating commercial parameters, dates, or schedule.
export async function PATCH(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const auth = await requireStaff();
  if (auth instanceof NextResponse) return auth;

  const body = await req.json();
  const existing = await prisma.calculation.findUnique({
    where: { id: params.id },
    include: {
      stages: { orderBy: { order: 'asc' } },
      template: { select: { workDayHours: true, includeWeekends: true } },
    },
  });
  if (!existing) return NextResponse.json({ error: 'not found' }, { status: 404 });
  if (existing.status === 'approved') {
    return NextResponse.json(
      { error: 'Расчёт уже утверждён и не может быть изменён' },
      { status: 409 },
    );
  }

  const roleRatesJson =
    body.roleRates !== undefined
      ? typeof body.roleRates === 'object'
        ? JSON.stringify(body.roleRates)
        : body.roleRates
      : existing.roleRates;

  const startDate = body.startDate ? new Date(body.startDate) : existing.startDate;

  await prisma.calculation.update({
    where: { id: params.id },
    data: {
      startDate,
      currency: body.currency ?? existing.currency,
      roleRates: roleRatesJson,
      overheadPercent: body.overheadPercent !== undefined ? Number(body.overheadPercent) : existing.overheadPercent,
      marginPercent: body.marginPercent !== undefined ? Number(body.marginPercent) : existing.marginPercent,
      discountPercent: body.discountPercent !== undefined ? Number(body.discountPercent) : existing.discountPercent,
      vatPercent: body.vatPercent !== undefined ? Number(body.vatPercent) : existing.vatPercent,
      includeVat: body.includeVat !== undefined ? Boolean(body.includeVat) : existing.includeVat,
    },
  });

  if (body.startDate) {
    const primary = existing.stages
      .filter((s) => !s.isApprovalTask)
      .map((s) => ({
        name: s.name,
        role: s.role,
        hours: s.hours,
        requirements: s.requirements,
        parallel: s.parallel,
        approvalDays: s.approvalDays,
      }));
    await rebuildStages(params.id, primary, startDate, scheduleConfigFromTemplate(existing.template));
  }

  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const auth = await requireStaff();
  if (auth instanceof NextResponse) return auth;

  await prisma.calculation.delete({ where: { id: params.id } });
  await writeAudit({
    actorType: 'user',
    actorId: auth.userId,
    action: 'calculation.delete',
    entityType: 'calculation',
    entityId: params.id,
    ip: clientIp(req),
  });
  return NextResponse.json({ ok: true });
}
