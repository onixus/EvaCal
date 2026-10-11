import { prisma } from '@/lib/prisma';
import CapacityAdmin from './CapacityAdmin';

export const dynamic = 'force-dynamic';

export default async function CapacityAdminPage() {
  const rows = await prisma.roleCapacity.findMany({
    orderBy: [{ role: 'asc' }, { effectiveFrom: 'desc' }],
  });
  return (
    <CapacityAdmin
      rows={rows.map((r) => ({
        id: r.id,
        role: r.role,
        headcount: r.headcount,
        hoursPerWeek: r.hoursPerWeek,
        effectiveFrom: r.effectiveFrom.toISOString().slice(0, 10),
        note: r.note,
      }))}
    />
  );
}
