import Link from 'next/link';
import { prisma } from '@/lib/prisma';
import UsersManager from './UsersManager';
import PageHeader from '@/components/PageHeader';

export const dynamic = 'force-dynamic';

export default async function AdminUsersPage() {
  const users = await prisma.user.findMany({
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      username: true,
      role: true,
      mustChangePassword: true,
      createdAt: true,
    },
  });

  return (
    <div className="page">
      <PageHeader
        title="Пользователи"
        description="Заводите учётные записи под роли платформы и переназначайте роль существующим пользователям."
        actions={
          <Link href="/admin" className="btn-secondary">
            ← К шаблонам
          </Link>
        }
      />

      <UsersManager users={JSON.parse(JSON.stringify(users))} />
    </div>
  );
}
