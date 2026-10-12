'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { QRCodeSVG } from 'qrcode.react';
import { Button } from '../ui/Button';

interface Account {
  id: string;
  email: string;
  name: string;
  surname: string | null;
}

interface Member {
  id: string;
  name: string;
  username: string;
  userId: string | null;
  hasPassword: boolean;
  lastSeenAt: string | null;
}

/** Shown once, right after a password is generated. */
interface PhoneSetup {
  name: string;
  username: string;
  password: string;
  url: string | null;
  link: string | null;
}

function PhoneSetupPanel({ setup, onClose }: { setup: PhoneSetup; onClose: () => void }) {
  const t = useTranslations('settings.family.setup');
  return (
    <section className="border border-primary/50 rounded-lg p-4 space-y-4" aria-live="polite">
      <div>
        <h3 className="text-lg font-semibold text-foreground">{t('title', { name: setup.name })}</h3>
        <p className="text-sm text-muted mt-1">{t('onlyOnce')}</p>
      </div>
      <div className="flex flex-col sm:flex-row gap-6">
        {setup.link && (
          <div className="shrink-0">
            <div className="bg-white p-3 rounded-lg inline-block">
              <QRCodeSVG value={setup.link} size={200} level="M" />
            </div>
            <p className="text-xs text-muted mt-2 max-w-[13rem]">{t('scan')}</p>
          </div>
        )}
        <div className="min-w-0 space-y-3">
          {!setup.link && <p className="text-sm text-muted">{t('noPublicUrl')}</p>}
          <p className="text-sm text-foreground">{t('manual')}</p>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
            <dt className="text-muted">{t('mode')}</dt>
            <dd className="font-mono text-foreground">HTTP</dd>
            <dt className="text-muted">{t('url')}</dt>
            <dd className="font-mono text-foreground break-all">{setup.url ?? t('yourUrl')}</dd>
            <dt className="text-muted">{t('username')}</dt>
            <dd className="font-mono text-foreground">{setup.username}</dd>
            <dt className="text-muted">{t('password')}</dt>
            <dd className="font-mono text-foreground select-all">{setup.password}</dd>
          </dl>
        </div>
      </div>
      <Button variant="secondary" size="sm" onClick={onClose}>
        {t('done')}
      </Button>
    </section>
  );
}

const inputClass =
  'w-full px-3 py-2 border border-border rounded-lg bg-surface text-foreground focus:outline-none focus:ring-2 focus:ring-primary';

function accountLabel(a: Account): string {
  return `${[a.name, a.surname].filter(Boolean).join(' ')} (${a.email})`;
}

/** Forget the cached "show the Family tab" answer, so link changes show up. */
function resetFamilyTabCache() {
  try {
    sessionStorage.removeItem('hyperion.familyTab');
  } catch {
    // ignore
  }
}

export default function FamilyMembersSettings() {
  const t = useTranslations('settings.family');
  const locale = useLocale();
  const [members, setMembers] = useState<Member[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);

  const [name, setName] = useState('');
  const [username, setUsername] = useState('');
  const [userId, setUserId] = useState('');
  const [saving, setSaving] = useState(false);
  const [setup, setSetup] = useState<PhoneSetup | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/family-members');
      if (!res.ok) throw new Error(String(res.status));
      const data = (await res.json()) as { members: Member[]; users: Account[] };
      setMembers(data.members);
      setAccounts(data.users);
    } catch {
      toast.error(t('loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  const linkedAccounts = new Set(members.map((m) => m.userId).filter(Boolean));

  const add = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await fetch('/api/admin/family-members', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, username, userId: userId || null }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.details?.[0]?.message || data.error || t('saveFailed'));
        return;
      }
      setSetup({ name, ...(data as { setup: Omit<PhoneSetup, 'name'> }).setup });
      setName('');
      setUsername('');
      setUserId('');
      resetFamilyTabCache();
      toast.success(t('added'));
      await load();
    } catch {
      toast.error(t('saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  const setAccount = async (member: Member, newUserId: string) => {
    const res = await fetch(`/api/admin/family-members/${member.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: newUserId || null }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      toast.error((data as { error?: string }).error || t('saveFailed'));
      return;
    }
    resetFamilyTabCache();
    toast.success(t('saved'));
    await load();
  };

  const newPassword = async (member: Member) => {
    if (member.hasPassword && !window.confirm(t('confirmNewPassword', { name: member.name }))) return;
    const res = await fetch(`/api/admin/family-members/${member.id}/password`, { method: 'POST' });
    if (!res.ok) {
      toast.error(t('saveFailed'));
      return;
    }
    const data = (await res.json()) as { setup: Omit<PhoneSetup, 'name'> };
    setSetup({ name: member.name, ...data.setup });
    await load();
  };

  const remove = async (member: Member) => {
    if (!window.confirm(t('confirmRemove', { name: member.name }))) return;
    const res = await fetch(`/api/admin/family-members/${member.id}`, { method: 'DELETE' });
    if (!res.ok) {
      toast.error(t('saveFailed'));
      return;
    }
    resetFamilyTabCache();
    toast.success(t('removed'));
    await load();
  };

  return (
    <div className="space-y-8">
      {setup && <PhoneSetupPanel setup={setup} onClose={() => setSetup(null)} />}
      <section>
        <h3 className="text-lg font-semibold text-foreground mb-3">{t('membersTitle')}</h3>
        {loading ? (
          <p className="text-sm text-muted">{t('loading')}</p>
        ) : members.length === 0 ? (
          <p className="text-sm text-muted">{t('empty')}</p>
        ) : (
          <ul className="divide-y divide-border border border-border rounded-lg">
            {members.map((m) => (
              <li key={m.id} className="p-3 flex flex-col sm:flex-row sm:items-center gap-3">
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-foreground">{m.name}</p>
                  <p className="text-xs font-mono text-muted">
                    {t('usernameLine', { username: m.username })}
                    {' · '}
                    {!m.hasPassword
                      ? t('noPassword')
                      : m.lastSeenAt
                        ? t('lastSeen', { date: new Date(m.lastSeenAt).toLocaleString(locale) })
                        : t('neverSeen')}
                  </p>
                </div>
                <label className="sr-only" htmlFor={`account-${m.id}`}>
                  {t('account')}
                </label>
                <select
                  id={`account-${m.id}`}
                  value={m.userId ?? ''}
                  onChange={(e) => void setAccount(m, e.target.value)}
                  className="sm:w-72 px-3 py-2 border border-border rounded-lg bg-surface text-foreground text-sm"
                >
                  <option value="">{t('noAccount')}</option>
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id} disabled={linkedAccounts.has(a.id) && a.id !== m.userId}>
                      {accountLabel(a)}
                    </option>
                  ))}
                </select>
                <Button variant="secondary" size="sm" onClick={() => void newPassword(m)}>
                  {t('newPassword')}
                </Button>
                <Button variant="secondary" size="sm" onClick={() => void remove(m)}>
                  {t('remove')}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h3 className="text-lg font-semibold text-foreground mb-1">{t('addTitle')}</h3>
        <p className="text-sm text-muted mb-4">{t('addHint')}</p>
        <form onSubmit={add} className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="fm-name" className="block mb-1 text-foreground">
              {t('name')}
            </label>
            <input id="fm-name" required value={name} onChange={(e) => setName(e.target.value)} className={inputClass} />
          </div>
          <div>
            <label htmlFor="fm-account" className="block mb-1 text-foreground">
              {t('account')}
            </label>
            <select id="fm-account" value={userId} onChange={(e) => setUserId(e.target.value)} className={inputClass}>
              <option value="">{t('noAccount')}</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id} disabled={linkedAccounts.has(a.id)}>
                  {accountLabel(a)}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="fm-user" className="block mb-1 text-foreground">
              {t('username')}
            </label>
            <input
              id="fm-user"
              required
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className={`${inputClass} font-mono`}
              autoCapitalize="none"
              spellCheck={false}
            />
          </div>
          <div className="sm:col-span-2">
            <Button type="submit" disabled={saving}>
              {saving ? t('saving') : t('add')}
            </Button>
          </div>
        </form>
      </section>

      <p className="text-xs text-muted">{t('mutualNote')}</p>
    </div>
  );
}
