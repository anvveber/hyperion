import { auth } from '@/lib/auth';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { isAdmin } from '@/lib/admin';
import { isFeatureEnabled } from '@/lib/features';
import UserManagement from '@/components/UserManagement';

export default async function UsersSettingsPage() {
  const session = await auth();
  const t = await getTranslations('settings.users');

  if (!session?.user) {
    redirect('/login');
  }

  if (!(await isAdmin(session.user.id))) {
    redirect('/settings');
  }

  return (
    <div className="bg-surface shadow rounded-lg p-6">
      <h2 className="text-xl font-bold text-foreground mb-4">{t('title')}</h2>
      <p className="text-muted mb-6">{t('description')}</p>
      <UserManagement
        currentUserId={session.user.id}
        passwordLoginEnabled={isFeatureEnabled('passwordLogin')}
        ssoEnabled={isFeatureEnabled('oidc')}
      />
    </div>
  );
}
