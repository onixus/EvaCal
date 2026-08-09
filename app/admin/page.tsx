import Link from 'next/link';
import { prisma } from '@/lib/prisma';
import NewTemplateForm from './NewTemplateForm';
import TemplateList from './TemplateList';

export const dynamic = 'force-dynamic';

export default async function AdminPage() {
  const templates = await prisma.formTemplate.findMany({
    orderBy: { createdAt: 'desc' },
    include: {
      _count: {
        select: { fields: true, stageTemplates: true, calculations: true },
      },
    },
  });

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
        <h2 className="mb-3 font-medium">Новый шаблон</h2>
        <NewTemplateForm />
      </div>

      <div className="card p-5">
        <h2 className="mb-3 font-medium">Шаблоны опросников</h2>
        <TemplateList templates={JSON.parse(JSON.stringify(templates))} />
      </div>
    </div>
  );
}
