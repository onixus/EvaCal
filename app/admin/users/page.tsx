import Link from "next/link";
import { prisma } from "@/lib/prisma";
import UsersManager from "./UsersManager";

export const dynamic = "force-dynamic";

export default async function AdminUsersPage() {
  const users = await prisma.user.findMany({
    orderBy: { createdAt: "desc" },
    select: { id: true, username: true, role: true, mustChangePassword: true, createdAt: true },
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Пользователи</h1>
          <p className="text-sm text-slate-500">
            Создавайте учётные записи для интерфейсов архитектора и администратора.
          </p>
        </div>
        <Link href="/admin" className="btn-secondary">
          ← К шаблонам
        </Link>
      </div>

      <UsersManager users={JSON.parse(JSON.stringify(users))} />
    </div>
  );
}
