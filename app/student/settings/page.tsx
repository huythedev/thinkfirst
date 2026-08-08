'use client';

import { useEffect, useState } from 'react';
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '@/lib/firebase/config';
import { useAuth } from '@/components/providers/AuthProvider';
import { Strictness } from '@/lib/types/user';

import { useTranslation } from '@/lib/i18n/client';

const LANGUAGES: { value: 'en' | 'vi'; label: string }[] = [
  { value: 'en', label: 'English' },
  { value: 'vi', label: 'Tiếng Việt' },
];

const GRADES = [6, 7, 8, 9, 10, 11, 12];

export default function StudentSettings() {
  const { user, profile, refreshProfile } = useAuth();
  const { t } = useTranslation();

  const STRICTNESS_OPTIONS: { value: Strictness; label: string; description: string }[] = [
    {
      value: 'supportive',
      label: t('settings.supportive'),
      description: t('settings.supportiveDesc'),
    },
    {
      value: 'balanced',
      label: t('settings.balanced'),
      description: t('settings.balancedDesc'),
    },
    {
      value: 'independence',
      label: t('settings.independence'),
      description: t('settings.independenceDesc'),
    },
  ];

  const [languageOverride, setLanguageOverride] = useState<'en' | 'vi' | null>(null);
  const [grade, setGrade] = useState<number>(8);
  const [strictness, setStrictness] = useState<Strictness>('balanced');
  const [accessibilitySettings, setAccessibilitySettings] = useState<string[]>([]);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);

  // Derived from the auth profile until the student picks something, so the
  // saved language shows up without an effect writing state on every render.
  const language = languageOverride ?? profile?.preferredLanguage ?? 'en';

  useEffect(() => {
    if (!user) return;
    let cancelled = false;

    const load = async () => {
      setLoading(true);
      setError('');
      try {
        const snapshot = await getDoc(doc(db, 'studentProfiles', user.uid));
        if (cancelled) return;
        if (snapshot.exists()) {
          const data = snapshot.data();
          if (typeof data.grade === 'number') setGrade(data.grade);
          const configured = data.assistanceProfile?.defaultStrictness;
          if (configured) setStrictness(configured as Strictness);
          if (Array.isArray(data.assistanceProfile?.accessibilitySettings)) {
            setAccessibilitySettings(data.assistanceProfile.accessibilitySettings);
          }
        }
      } catch (err) {
        if (!cancelled) setError('Could not load your settings. Please refresh and try again.');
        console.error('Failed to load student profile', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    load();
    return () => {
      cancelled = true;
    };
  }, [user]);

  const handleSave = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!user) return;

    setSaving(true);
    setError('');
    setSaved(false);

    try {
      // preferredLanguage lives on users/{uid}; security rules allow only
      // displayName, preferredLanguage and updatedAt to change from the client.
      await setDoc(
        doc(db, 'users', user.uid),
        { preferredLanguage: language, updatedAt: serverTimestamp() },
        { merge: true }
      );

      await setDoc(
        doc(db, 'studentProfiles', user.uid),
        {
          grade,
          assistanceProfile: { defaultStrictness: strictness, accessibilitySettings },
          updatedAt: serverTimestamp(),
        },
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

  if (!user) return null;

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <header>
        <h1 className="text-3xl font-bold text-foreground">{t('settings.accountSettings')}</h1>
        <p className="text-foreground-muted mt-2">
          {t('settings.applyToEverySession')}
        </p>
      </header>

      {loading ? (
        <div className="bg-surface rounded-2xl border border-border shadow-sm p-8 animate-pulse space-y-4">
          <div className="h-4 w-40 bg-surface-muted rounded" />
          <div className="h-10 w-full bg-surface-muted rounded" />
          <div className="h-4 w-40 bg-surface-muted rounded" />
          <div className="h-10 w-full bg-surface-muted rounded" />
        </div>
      ) : (
        <form onSubmit={handleSave} className="bg-surface rounded-2xl border border-border shadow-sm p-8 space-y-8">
          <div>
            <label htmlFor="language" className="block font-medium text-foreground">
              {t('settings.language')}
            </label>
            <p className="text-sm text-foreground-muted mt-1">{t('settings.languageTutorDesc')}</p>
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

          <div>
            <label htmlFor="grade" className="block font-medium text-foreground">
              {t('settings.grade')}
            </label>
            <p className="text-sm text-foreground-muted mt-1">{t('settings.gradeDesc')}</p>
            <select
              id="grade"
              value={grade}
              onChange={(event) => setGrade(Number(event.target.value))}
              className="mt-3 w-full border border-border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {GRADES.map((value) => (
                <option key={value} value={value}>
                  Grade {value}
                </option>
              ))}
            </select>
          </div>

          <fieldset>
            <legend className="font-medium text-foreground">{t('settings.helpAmount')}</legend>
            <p className="text-sm text-foreground-muted mt-1">
              {t('settings.helpAmountDesc')}
            </p>
            <div className="mt-3 space-y-2">
              {STRICTNESS_OPTIONS.map((option) => (
                <label
                  key={option.value}
                  className={`flex gap-3 items-start border-2 rounded-xl p-4 cursor-pointer transition-colors ${
                    strictness === option.value
                      ? 'border-blue-600 bg-blue-50'
                      : 'border-border hover:border-border'
                  }`}
                >
                  <input
                    type="radio"
                    name="strictness"
                    value={option.value}
                    checked={strictness === option.value}
                    onChange={() => setStrictness(option.value)}
                    className="mt-1"
                  />
                  <span>
                    <span className="block font-medium text-foreground">{option.label}</span>
                    <span className="block text-sm text-foreground-muted">{option.description}</span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>

          {error && <p className="text-sm text-red-600">{error}</p>}
          {saved && !error && <p className="text-sm text-green-700">{t('common.saved')}</p>}

          <div className="flex items-center gap-3">
            <button
              type="submit"
              disabled={saving}
              className="px-6 py-3 bg-blue-600 text-white font-medium rounded-xl hover:bg-blue-700 disabled:opacity-60"
            >
              {saving ? t('common.saving') : t('common.save')}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
