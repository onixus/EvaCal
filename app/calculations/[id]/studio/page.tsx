import { notFound } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import { requireRole } from '@/lib/auth';
import Gost34Studio from '@/components/gost34/studio/Gost34Studio';

export const dynamic = 'force-dynamic';

export default async function Gost34StudioPage(props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  // Возврат после логина — в саму студию, а не на список расчётов.
  await requireRole(['architect', 'admin'], `/calculations/${params.id}/studio`);

  const calculation = await prisma.calculation.findUnique({
    where: { id: params.id },
    select: {
      id: true,
      name: true,
      customer: true,
      project: { select: { customer: true } },
    },
  });
  if (!calculation) notFound();

  return (
    <Gost34Studio
      calculationId={calculation.id}
      calculationName={calculation.name}
      customerName={calculation.project?.customer || calculation.customer}
    />
  );
}
