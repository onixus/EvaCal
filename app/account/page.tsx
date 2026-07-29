import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import ChangePasswordForm from "./ChangePasswordForm";

export default async function AccountPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  return (
    <div className="mx-auto max-w-sm space-y-4">
      <div>
        <h1 className="text-xl font-semibold">Аккаунт</h1>
        <p className="text-sm text-slate-500">
          {session.username} · {session.role === "admin" ? "Администратор" : "Архитектор"}
        </p>
      </div>
      <div className="card p-6">
        <h2 className="mb-3 font-medium">Сменить пароль</h2>
        <ChangePasswordForm />
      </div>
    </div>
  );
}
