import Link from "next/link";

export default function AuthBar({ username, roleLabel }: { username: string; roleLabel: string }) {
  return (
    <div className="mb-4 flex items-center justify-between rounded-lg bg-slate-100 px-4 py-2 text-sm">
      <span>
        Вы вошли как <strong>{username}</strong> ({roleLabel})
      </span>
      <Link href="/account" className="text-brand-700 hover:underline">
        Сменить пароль
      </Link>
    </div>
  );
}
