import { prisma } from '@/lib/prisma';
import { appRoleLabel } from '@/lib/appRoles';
import {
  CHANGE_SOURCE_LABELS,
  formatChangeNumber,
  isChangeSource,
  type ChangeSource,
  type InternalChangeRow,
} from '@/lib/changelogTypes';

// Реэкспорт, чтобы серверный код мог тянуть всё из одного модуля.
export * from '@/lib/changelogTypes';

/**
 * Лист внутренних изменений (ЛВИ) — журнал правок комплекта и расчёта, который
 * выгружается в .xlsx и кладётся отдельным файлом в комплект ГОСТ 34.
 *
 * Запись создаётся в четырёх местах: inline-правка раздела в студии, загрузка
 * версии тех.писателя, решение ревью и выпуск комплекта. Ничего не удаляется и
 * не переписывается — лист неизменяем, исправление оформляется новой строкой.
 */

export interface RecordChangeInput {
  calculationId: string;
  author: string;
  role: string;
  docRef: string;
  text: string;
  source: ChangeSource;
  packageId?: string | null;
}

/**
 * Добавляет запись в лист. Номер выдаётся последовательно в пределах расчёта.
 *
 * Номер считается внутри транзакции, а не запросом «max + 1» снаружи: две
 * параллельные правки (тех.писатель загрузил версию, пока архитектор правит
 * раздел) иначе получили бы один и тот же номер, и уникальный индекс
 * `[calculationId, seq]` уронил бы вторую.
 */
export async function recordInternalChange(input: RecordChangeInput) {
  return prisma.$transaction(async (tx) => {
    const last = await tx.internalChange.findFirst({
      where: { calculationId: input.calculationId },
      orderBy: { seq: 'desc' },
      select: { seq: true },
    });

    return tx.internalChange.create({
      data: {
        calculationId: input.calculationId,
        seq: (last?.seq ?? 0) + 1,
        author: input.author,
        role: input.role,
        docRef: input.docRef,
        text: input.text,
        source: input.source,
        packageId: input.packageId ?? null,
      },
    });
  });
}

/**
 * Запись в листе — побочный эффект основного действия, а не его цель. Падение
 * журнала не должно откатывать загруженную версию или отправленное решение
 * ревью, поэтому ошибка логируется и проглатывается.
 */
export async function recordInternalChangeSafe(input: RecordChangeInput): Promise<void> {
  try {
    await recordInternalChange(input);
  } catch (err) {
    console.error('Не удалось записать строку листа внутренних изменений:', err);
  }
}

export function serializeChange(change: {
  id: string;
  seq: number;
  occurredAt: Date;
  author: string;
  role: string;
  docRef: string;
  text: string;
  source: string;
  packageId: string | null;
}): InternalChangeRow {
  // Источник из БД не сужен типом: строка, записанная старой версией кода,
  // должна показаться как есть, а не уронить страницу.
  const source = isChangeSource(change.source) ? change.source : 'calculation';

  return {
    id: change.id,
    num: formatChangeNumber(change.seq),
    seq: change.seq,
    occurredAt: change.occurredAt.toISOString(),
    author: change.author,
    role: change.role,
    roleLabel: appRoleLabel(change.role),
    docRef: change.docRef,
    text: change.text,
    source,
    sourceLabel: CHANGE_SOURCE_LABELS[source],
    packageId: change.packageId,
  };
}

/** Лист расчёта, новые записи сверху — как в выгрузке и на экране. */
export async function listInternalChanges(calculationId: string): Promise<InternalChangeRow[]> {
  const rows = await prisma.internalChange.findMany({
    where: { calculationId },
    orderBy: { seq: 'desc' },
  });
  return rows.map(serializeChange);
}
