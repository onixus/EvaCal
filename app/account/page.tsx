import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import ChangePasswordForm from './ChangePasswordForm';
import PageHeader from '@/components/PageHeader';

export default async function AccountPage() {
  const session = await getSession();
  if (!session) redirect('/login');

  return (
    <div className="page-narrow">
      <PageHeader title="Аккаунт" description="Настройки вашей учётной записи." />
      <div className="card max-w-sm">
        <div className="card-head">
          <span className="card-title">Сменить пароль</span>
        </div>
        <div className="p-4">
          <ChangePasswordForm />
        </div>
      </div>
    </div>
  );
}
