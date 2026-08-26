import { Suspense } from 'react';
import LoginForm from './LoginForm';

export default function LoginPage() {
  return (
    <div className="mx-auto max-w-sm">
      <div className="card p-6">
        <h1 className="mb-1 text-xl font-semibold">Вход</h1>
        <p className="mb-5 text-sm text-slate-500">
          Пресейл, архитектор, ревьювер документации и администратор. После входа откроется рабочий
          экран вашей роли.
        </p>
        <Suspense>
          <LoginForm />
        </Suspense>
      </div>
    </div>
  );
}
