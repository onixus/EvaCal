import { notFound } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import TemplateEditor from './TemplateEditor';

export const dynamic = 'force-dynamic';

export default async function AdminTemplatePage(props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const [template, calendars] = await Promise.all([
    prisma.formTemplate.findUnique({
      where: { id: params.id },
      include: {
        fields: { orderBy: { order: 'asc' } },
        stageTemplates: { orderBy: { order: 'asc' } },
        riskTemplates: { orderBy: { order: 'asc' } },
      },
    }),
    prisma.workCalendar.findMany({
      orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
      select: { id: true, name: true, isDefault: true },
    }),
  ]);
  if (!template) notFound();

  return <TemplateEditor template={JSON.parse(JSON.stringify(template))} calendars={calendars} />;
}
