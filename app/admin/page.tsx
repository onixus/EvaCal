import Link from 'next/link';
import { prisma } from '@/lib/prisma';
import NewTemplateForm from './NewTemplateForm';
import TemplateList from './TemplateList';
import PresetImportPanel from '@/components/PresetImportPanel';
import Pagination from '@/components/Pagination';
import { PAGE_SIZE, pageArgs, parsePage } from '@/lib/pagination';
import PageHeader from '@/components/PageHeader';

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
    <div className="page">
      <PageHeader
        title="Интерфейс администратора"
        description="Визуальный конструктор форм: создавайте шаблоны опросников и настраивайте формулы этапов."
        actions={
          <>
            <Link href="/admin/capacity" className="btn-secondary">
              Ёмкость ролей
            </Link>
            <Link href="/admin/users" className="btn-secondary">
              Пользователи
            </Link>
          </>
        }
      />

      <div className="card p-4">
        <PresetImportPanel />
      </div>

      <div className="card">
        <div className="card-head">
          <span className="card-title">Новый шаблон</span>
        </div>
        <div className="p-4">
          <NewTemplateForm />
        </div>
      </div>

      <div className="card overflow-hidden">
        <div className="card-head">
          <span className="card-title">Шаблоны опросников</span>
        </div>
        <TemplateList templates={JSON.parse(JSON.stringify(templates))} />
        <div className="px-4 pb-4">
          <Pagination page={page} pageSize={PAGE_SIZE} total={total} basePath="/admin" />
        </div>
      </div>
    </div>
  );
}
