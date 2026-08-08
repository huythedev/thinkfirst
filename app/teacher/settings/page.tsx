'use client';

import { useState } from 'react';
import { doc, setDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '@/lib/firebase/config';
import { useAuth } from '@/components/providers/AuthProvider';
import { useTranslation } from '@/lib/i18n/client';

const LANGUAGES = [
  { value: 'en', label: 'English' },
  { value: 'vi', label: 'Tiếng Việt' },
];

export default function TeacherSettings() {
  const { user, profile, refreshProfile } = useAuth();
  const { t } = useTranslation();

  const [languageOverride, setLanguageOverride] = useState<'en' | 'vi' | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);

  const language = languageOverride ?? profile?.preferredLanguage ?? 'en';

  const handleSave = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!user) return;

    setSaving(true);
    setError('');
    setSaved(false);

    try {
      await setDoc(
        doc(db, 'users', user.uid),
        { preferredLanguage: language, updatedAt: serverTimestamp() },
        { merge: true }
      );

      await refreshProfile();
      setSaved(true);
    } catch (err) {
      console.error('Failed to save settings', err);
      setError(t('settings.couldNotSave'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-foreground">{t('settings.accountSettings')}</h1>
        <p className="text-foreground-muted mt-2">{t('teacher.languageDesc')}</p>
      </div>

      <div className="bg-surface p-8 rounded-xl border border-border shadow-sm max-w-2xl">
        <h2 className="text-xl font-semibold text-foreground mb-6">{t('teacher.profileInfo')}</h2>
        
        <div className="space-y-4 mb-8">
          <div>
            <label className="block text-sm font-medium text-foreground-muted">{t('teacher.name')}</label>
            <p className="mt-1 text-foreground bg-background p-2 rounded border border-border">
              {profile?.displayName || t('auth.notProvided')}
            </p>
          </div>
          
          <div>
            <label className="block text-sm font-medium text-foreground-muted">{t('teacher.email')}</label>
            <p className="mt-1 text-foreground bg-background p-2 rounded border border-border">
              {user?.email || t('auth.notProvided')}
            </p>
          </div>
          
          <div>
            <label className="block text-sm font-medium text-foreground-muted">{t('teacher.role')}</label>
            <p className="mt-1 text-foreground bg-background p-2 rounded border border-border capitalize">
              {profile?.role || t('auth.unknown')}
            </p>
          </div>
        </div>

        <form onSubmit={handleSave} className="space-y-6 border-t border-border pt-6">
          <div>
            <label htmlFor="language" className="block font-medium text-foreground">
              {t('teacher.language')}
            </label>
            <select
              id="language"
              value={language}
              onChange={(event) => setLanguageOverride(event.target.value as 'en' | 'vi')}
              className="mt-3 w-full border border-border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {LANGUAGES.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}
          {saved && !error && <p className="text-sm text-green-700">{t('common.saved')}</p>}

          <button
            type="submit"
            disabled={saving}
            className="px-6 py-3 bg-blue-600 text-white font-medium rounded-xl hover:bg-blue-700 disabled:opacity-60"
          >
            {saving ? t('common.saving') : t('common.save')}
          </button>
        </form>
      </div>
    </div>
  );
}
