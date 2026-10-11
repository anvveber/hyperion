import { auth } from '@/lib/auth';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import TrashManager from '@/components/TrashManager';
import { getTrashRetentionDays } from '@/lib/trash-retention';

export default async function TrashSettingsPage() {
  const session = await auth();
  const t = await getTranslations('settings.trash');
  const retentionDays = getTrashRetentionDays();

  if (!session?.user) {
    redirect('/login');
  }

  return (
    <div className="bg-surface shadow rounded-lg p-6">
      <h2 className="text-xl font-bold text-foreground mb-4">
        {t('title')}
      </h2>
      <p className="text-muted mb-6">
        {retentionDays === null
          ? t('pageDescriptionNever')
          : t('pageDescription', { days: retentionDays })}
      </p>
      <TrashManager retentionDays={retentionDays} />
    </div>
  );
}
