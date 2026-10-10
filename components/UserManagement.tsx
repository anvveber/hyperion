'use client';

import { useCallback, useEffect, useState, FormEvent } from 'react';
import { useTranslations } from 'next-intl';
import { PasswordStrengthIndicator } from '@/components/PasswordStrengthIndicator';

type UserRole = 'ADMIN' | 'USER';

interface AdminUser {
  id: string;
  email: string;
  name: string;
  surname: string | null;
  role: UserRole;
  provider: string | null;
  hasPassword: boolean;
  createdAt: string;
  lastLoginAt: string | null;
}

interface UserManagementProps {
  currentUserId: string;
  passwordLoginEnabled: boolean;
  ssoEnabled: boolean;
}

const inputClass =
  'w-full px-3 py-2 border border-border rounded-lg bg-surface text-foreground focus:outline-none focus:ring-2 focus:ring-primary';

export default function UserManagement({
  currentUserId,
  passwordLoginEnabled,
  ssoEnabled,
}: UserManagementProps) {
  const t = useTranslations('settings.users');

  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const [name, setName] = useState('');
  const [surname, setSurname] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<UserRole>('USER');
  const [creating, setCreating] = useState(false);

  // Row whose password-reset field is open, and its value
  const [resetUserId, setResetUserId] = useState<string | null>(null);
  const [resetPassword, setResetPassword] = useState('');

  const passwordRequired = passwordLoginEnabled && !ssoEnabled;

  const loadUsers = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/users');
      if (!res.ok) throw new Error('load failed');
      const data = await res.json();
      setUsers(data.users ?? []);
    } catch {
      setError(t('errorLoad'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    loadUsers();
  }, [loadUsers]);

  const handleCreate = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError('');
    setNotice('');
    setCreating(true);
    try {
      const res = await fetch('/api/admin/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          surname: surname.trim() || null,
          email: email.trim(),
          password: password || null,
          role,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.details?.[0]?.message || data.error || t('errorCreate'));
        return;
      }
      setNotice(t('created', { email: data.user.email }));
      setName('');
      setSurname('');
      setEmail('');
      setPassword('');
      setRole('USER');
      await loadUsers();
    } catch {
      setError(t('errorConnection'));
    } finally {
      setCreating(false);
    }
  };

  const updateUser = async (id: string, body: { role?: UserRole; password?: string }) => {
    setError('');
    setNotice('');
    try {
      const res = await fetch(`/api/admin/users/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.details?.[0]?.message || data.error || t('errorUpdate'));
        return false;
      }
      await loadUsers();
      return true;
    } catch {
      setError(t('errorConnection'));
      return false;
    }
  };

  const handleRoleToggle = async (user: AdminUser) => {
    const nextRole: UserRole = user.role === 'ADMIN' ? 'USER' : 'ADMIN';
    const message = nextRole === 'ADMIN' ? t('confirmMakeAdmin') : t('confirmRemoveAdmin');
    if (!confirm(message)) return;
    await updateUser(user.id, { role: nextRole });
  };

  const handleResetPassword = async (e: FormEvent<HTMLFormElement>, user: AdminUser) => {
    e.preventDefault();
    if (await updateUser(user.id, { password: resetPassword })) {
      setNotice(t('passwordReset', { email: user.email }));
      setResetUserId(null);
      setResetPassword('');
    }
  };

  const handleDelete = async (user: AdminUser) => {
    if (!confirm(t('confirmDelete', { email: user.email }))) return;
    setError('');
    setNotice('');
    try {
      const res = await fetch(`/api/admin/users/${user.id}`, { method: 'DELETE' });
      if (!res.ok) {
        const data = await res.json();
        setError(data.error || t('errorDelete'));
        return;
      }
      await loadUsers();
    } catch {
      setError(t('errorConnection'));
    }
  };

  const formatDate = (value: string | null) =>
    value ? new Date(value).toLocaleDateString() : t('never');

  return (
    <div className="space-y-8">
      {error && (
        <div role="alert" className="bg-warning/10 border border-warning/30 text-warning px-4 py-3 rounded">
          {error}
        </div>
      )}
      {notice && (
        <div role="status" className="bg-green-50 dark:bg-green-900/20 border border-green-400 dark:border-green-800 text-green-700 dark:text-green-300 px-4 py-3 rounded">
          {notice}
        </div>
      )}

      <form onSubmit={handleCreate} className="space-y-4">
        <h3 className="text-lg font-semibold text-foreground">{t('createTitle')}</h3>

        <div className="flex flex-col sm:flex-row gap-4">
          <div className="flex-1">
            <label htmlFor="new-user-name" className="block text-sm font-medium text-muted mb-1">
              {t('nameLabel')}
            </label>
            <input
              id="new-user-name"
              type="text"
              required
              maxLength={100}
              value={name}
              onChange={(e) => setName(e.target.value)}
              className={inputClass}
            />
          </div>
          <div className="flex-1">
            <label htmlFor="new-user-surname" className="block text-sm font-medium text-muted mb-1">
              {t('surnameLabel')}
            </label>
            <input
              id="new-user-surname"
              type="text"
              maxLength={100}
              value={surname}
              onChange={(e) => setSurname(e.target.value)}
              className={inputClass}
            />
          </div>
        </div>

        <div className="flex flex-col sm:flex-row gap-4">
          <div className="flex-1">
            <label htmlFor="new-user-email" className="block text-sm font-medium text-muted mb-1">
              {t('emailLabel')}
            </label>
            <input
              id="new-user-email"
              type="email"
              required
              autoComplete="off"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={inputClass}
            />
          </div>
          <div className="sm:w-48">
            <label htmlFor="new-user-role" className="block text-sm font-medium text-muted mb-1">
              {t('roleLabel')}
            </label>
            <select
              id="new-user-role"
              value={role}
              onChange={(e) => setRole(e.target.value as UserRole)}
              className={inputClass}
            >
              <option value="USER">{t('roleUser')}</option>
              <option value="ADMIN">{t('roleAdmin')}</option>
            </select>
          </div>
        </div>

        {passwordLoginEnabled && (
          <div className="space-y-2">
            <label htmlFor="new-user-password" className="block text-sm font-medium text-muted mb-1">
              {passwordRequired ? t('passwordLabel') : t('passwordOptionalLabel')}
            </label>
            <input
              id="new-user-password"
              type="password"
              required={passwordRequired}
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={inputClass}
            />
            {password && <PasswordStrengthIndicator password={password} showRequirements={true} />}
            <p className="text-sm text-muted">
              {passwordRequired ? t('passwordHint') : t('passwordOptionalHint')}
            </p>
          </div>
        )}
        {!passwordLoginEnabled && (
          <p className="text-sm text-muted">{t('ssoOnlyHint')}</p>
        )}

        <div className="flex justify-end">
          <button
            type="submit"
            disabled={creating}
            className="px-6 py-2 bg-primary text-on-primary rounded-lg font-semibold hover:bg-primary-dark transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {creating ? t('creating') : t('createButton')}
          </button>
        </div>
      </form>

      <div className="space-y-3">
        <h3 className="text-lg font-semibold text-foreground">{t('existingTitle')}</h3>

        {loading ? (
          <p className="text-muted">{t('loading')}</p>
        ) : (
          <ul className="divide-y divide-border border border-border rounded-lg overflow-hidden">
            {users.map((user) => {
              const isSelf = user.id === currentUserId;
              return (
                <li key={user.id} className="px-4 py-3 bg-surface space-y-3">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-medium text-foreground truncate">
                        {[user.name, user.surname].filter(Boolean).join(' ')}
                        {user.role === 'ADMIN' && (
                          <span className="ml-2 inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-primary/10 text-primary">
                            {t('roleAdmin')}
                          </span>
                        )}
                        {isSelf && (
                          <span className="ml-2 inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-surface-elevated text-muted">
                            {t('you')}
                          </span>
                        )}
                      </p>
                      <p className="text-sm text-muted truncate">
                        {user.email} · {t('createdAt')}: {formatDate(user.createdAt)} · {t('lastLogin')}: {formatDate(user.lastLoginAt)}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2 flex-shrink-0">
                      <button
                        type="button"
                        onClick={() => handleRoleToggle(user)}
                        className="px-3 py-1.5 text-sm border border-border text-foreground rounded-lg hover:bg-surface-elevated transition-colors"
                      >
                        {user.role === 'ADMIN' ? t('removeAdmin') : t('makeAdmin')}
                      </button>
                      {passwordLoginEnabled && !isSelf && (
                        <button
                          type="button"
                          onClick={() => {
                            setResetUserId(resetUserId === user.id ? null : user.id);
                            setResetPassword('');
                          }}
                          aria-expanded={resetUserId === user.id}
                          className="px-3 py-1.5 text-sm border border-border text-foreground rounded-lg hover:bg-surface-elevated transition-colors"
                        >
                          {t('resetPassword')}
                        </button>
                      )}
                      {!isSelf && (
                        <button
                          type="button"
                          onClick={() => handleDelete(user)}
                          className="px-3 py-1.5 text-sm border border-warning/40 text-warning rounded-lg hover:bg-warning/10 transition-colors"
                        >
                          {t('delete')}
                        </button>
                      )}
                    </div>
                  </div>

                  {resetUserId === user.id && (
                    <form onSubmit={(e) => handleResetPassword(e, user)} className="space-y-2">
                      <label htmlFor={`reset-${user.id}`} className="block text-sm font-medium text-muted">
                        {t('newPasswordLabel')}
                      </label>
                      <div className="flex flex-col sm:flex-row gap-2">
                        <input
                          id={`reset-${user.id}`}
                          type="password"
                          required
                          autoComplete="new-password"
                          value={resetPassword}
                          onChange={(e) => setResetPassword(e.target.value)}
                          className={inputClass}
                        />
                        <button
                          type="submit"
                          className="px-4 py-2 bg-primary text-on-primary rounded-lg font-medium hover:bg-primary-dark transition-colors"
                        >
                          {t('savePassword')}
                        </button>
                      </div>
                      {resetPassword && <PasswordStrengthIndicator password={resetPassword} showRequirements={true} />}
                    </form>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
