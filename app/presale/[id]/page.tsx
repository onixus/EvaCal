import { notFound } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import PresaleCalculationEditor from './PresaleCalculationEditor';
import ShareTokenRecovery from '@/components/ShareTokenRecovery';
import { resolvePageAccess } from '@/lib/access';

export const dynamic = 'force-dynamic';

export default async function PresaleCalculationPage(props: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ share?: string }>;
}) {
  const params = await props.params;
  const searchParams = await props.searchParams;

  const access = await resolvePageAccess(params.id, ['read'], searchParams.share);
  if (!access) {
    // May still recover via sessionStorage on the client.
    return <ShareTokenRecovery calculationId={params.id} pathPrefix="/presale" />;
  }

  const calculation = await prisma.calculation.findUnique({
    where: { id: params.id },
    include: {
      template: { include: { fields: { orderBy: { order: 'asc' } } } },
      stages: { orderBy: { order: 'asc' } },
      risks: { orderBy: { order: 'asc' } },
    },
  });
  if (!calculation) notFound();

  return (
    <PresaleCalculationEditor
      calculation={JSON.parse(
        JSON.stringify({
          ...calculation,
          answers: JSON.parse(calculation.answers),
        }),
      )}
      shareToken={searchParams.share ?? null}
    />
  );
}
