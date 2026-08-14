import Link from 'next/link';
import { prisma } from '@/lib/prisma';
import NewTemplateForm from './NewTemplateForm';
import TemplateList from './TemplateList';
import PresetImportPanel from '@/components/PresetImportPanel';
import Pagination from '@/components/Pagination';
import { PAGE_SIZE, pageArgs, parsePage } from '@/lib/pagination';

export const dynamic = 'force-dynamic';

export default async function AdminPage(props: { searchParams: Promise<{ page?: string }> }) {
  const page = parsePage((await props.searchParams).page);

  const [total, templates] = await Promise.all([
    prisma.formTemplate.count(),
    prisma.formTemplate.findMany({
      ...pageArgs(page),
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      include: {
        _count: {
          select: { fields: true, stageTemplates: true, calculations: true },
        },
      },
    }),
  ]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Интерфейс администратора</h1>
          <p className="text-sm text-slate-500">
            Визуальный конструктор форм: создавайте шаблоны опросников и настраивайте формулы
            этапов.
          </p>
        </div>
        <Link href="/admin/users" className="btn-secondary">
          Пользователи
        </Link>
      </div>

      <div className="card p-6">
        <PresetImportPanel />
      </div>

      <div className="card p-6">
        <h2 className="mb-3 font-medium">Новый шаблон</h2>
        <NewTemplateForm />
      </div>

      <div className="card p-5">
        <h2 className="mb-3 font-medium">Шаблоны опросников</h2>
        <TemplateList templates={JSON.parse(JSON.stringify(templates))} />
        <Pagination page={page} pageSize={PAGE_SIZE} total={total} basePath="/admin" />
      </div>
    </div>
  );
}
