import { Suspense } from 'react';
import LoginForm from './LoginForm';
import PageHeader from '@/components/PageHeader';

export default function LoginPage() {
  return (
    <div className="page-narrow">
      <div className="mx-auto max-w-sm space-y-5">
        <PageHeader
          title="Вход"
          description="Пресейл, архитектор, ревьювер документации и администратор. После входа откроется рабочий экран вашей роли."
        />
        <div className="card p-5">
          <Suspense>
            <LoginForm />
          </Suspense>
        </div>
      </div>
    </div>
  );
}
