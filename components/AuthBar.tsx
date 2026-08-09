import Link from 'next/link';

export default function AuthBar({ username, roleLabel }: { username: string; roleLabel: string }) {
  return (
    <div className="mb-4 flex items-center justify-between rounded-lg bg-slate-100 px-4 py-2 text-sm dark:bg-nord-3">
      <span className="dark:text-nord-4">
        Вы вошли как <strong>{username}</strong> ({roleLabel})
      </span>
      <Link href="/account" className="text-brand-700 hover:underline dark:text-nord-frost2">
        Сменить пароль
      </Link>
    </div>
  );
}
