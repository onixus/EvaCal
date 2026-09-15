import { notFound } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import ArchitectEditor from './ArchitectEditor';
import { getSession } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export default async function ArchitectCalculationPage(props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const calculation = await prisma.calculation.findUnique({
    where: { id: params.id },
    include: {
      template: { select: { name: true } },
      project: { select: { id: true, name: true } },
      stages: { orderBy: { order: 'asc' } },
      risks: { orderBy: { order: 'asc' } },
    },
  });
  if (!calculation) notFound();
  const session = await getSession();

  return (
    <ArchitectEditor
      calculation={JSON.parse(JSON.stringify(calculation))}
      viewerRole={session?.role ?? 'architect'}
    />
  );
}
