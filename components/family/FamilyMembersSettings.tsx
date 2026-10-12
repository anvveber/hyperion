'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
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
  recorderUser: string;
  recorderDevice: string;
  userId: string | null;
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
  const [members, setMembers] = useState<Member[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);

  const [name, setName] = useState('');
  const [recorderUser, setRecorderUser] = useState('');
  const [recorderDevice, setRecorderDevice] = useState('phone');
  const [userId, setUserId] = useState('');
  const [saving, setSaving] = useState(false);

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
        body: JSON.stringify({ name, recorderUser, recorderDevice, userId: userId || null }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.details?.[0]?.message || data.error || t('saveFailed'));
        return;
      }
      setName('');
      setRecorderUser('');
      setRecorderDevice('phone');
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
                    {t('recorderIdentity', { user: m.recorderUser, device: m.recorderDevice })}
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
              {t('recorderUser')}
            </label>
            <input
              id="fm-user"
              required
              value={recorderUser}
              onChange={(e) => setRecorderUser(e.target.value)}
              className={`${inputClass} font-mono`}
              autoCapitalize="none"
              spellCheck={false}
            />
          </div>
          <div>
            <label htmlFor="fm-device" className="block mb-1 text-foreground">
              {t('recorderDevice')}
            </label>
            <input
              id="fm-device"
              required
              value={recorderDevice}
              onChange={(e) => setRecorderDevice(e.target.value)}
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
