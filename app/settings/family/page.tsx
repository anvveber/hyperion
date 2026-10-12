import { auth } from '@/lib/auth';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { isAdmin } from '@/lib/admin';
import { isLocationSharingEnabled } from '@/lib/family-locations';
import FamilyMembersSettings from '@/components/family/FamilyMembersSettings';

export default async function FamilySettingsPage() {
  const session = await auth();
  const t = await getTranslations('settings.family');

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
      {isLocationSharingEnabled() ? (
        <FamilyMembersSettings />
      ) : (
        <p className="text-sm text-muted border border-border rounded-lg p-4">{t('notConfigured')}</p>
      )}
    </div>
  );
}
