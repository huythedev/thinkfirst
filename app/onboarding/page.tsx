'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { doc, setDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '@/lib/firebase/config';
import { useAuth } from '@/components/providers/AuthProvider';
import { Role } from '@/lib/types/user';
import { getTranslation } from '@/lib/i18n';

export default function OnboardingPage() {
  const router = useRouter();
  const { user, profile, refreshProfile } = useAuth();
  
  const [step, setStep] = useState(1);
  const [role, setRole] = useState<Role | null>(null);
  const [language, setLanguage] = useState<'vi' | 'en'>('en');
  const [grade, setGrade] = useState<number>(8);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const { t } = getTranslation(language);

  useEffect(() => {
    if (profile) {
      router.push(profile.role === 'teacher' ? '/teacher' : '/student');
    }
  }, [profile, router]);

  // If already onboarded, shouldn't be here (handled by layouts/routes, but just in case)
  if (!user) return null;

  if (profile) {
    return null;
  }

  const handleComplete = async () => {
    if (!role) return;
    setLoading(true);
    setError('');

    try {
      const batch = [];
      const userRef = doc(db, 'users', user.uid);
      
      const userData = {
        id: user.uid,
        role,
        displayName: user.displayName || 'Anonymous',
        preferredLanguage: language,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };
      
      await setDoc(userRef, userData);

      if (role === 'student') {
        const studentRef = doc(db, 'studentProfiles', user.uid);
        await setDoc(studentRef, {
          userId: user.uid,
          grade,
          subjects: ['mathematics'], // Default for MVP
          classroomIds: [],
          assistanceProfile: {
            defaultStrictness: 'balanced',
            accessibilitySettings: []
          },
          consentStatus: 'unknown',
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      } else if (role === 'teacher') {
        const teacherRef = doc(db, 'teacherProfiles', user.uid);
        await setDoc(teacherRef, {
          userId: user.uid,
          classroomIds: [],
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }

      await refreshProfile();
      router.push(role === 'teacher' ? '/teacher' : '/student');
    } catch (err: any) {
      console.error(err);
      setError(t('onboarding.error'));
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center p-4">
      <div className="max-w-xl w-full bg-surface rounded-2xl shadow-sm p-8 border border-border">
        <h1 className="text-2xl font-bold text-foreground mb-6">{t('onboarding.welcome')}</h1>
        
        {error && (
          <div className="mb-4 bg-red-50 text-red-700 p-3 rounded-lg text-sm">
            {error}
          </div>
        )}

        {step === 1 && (
          <div className="space-y-6">
            <h2 className="text-lg font-medium text-foreground-muted">{t('onboarding.roleQuestion')}</h2>
            <div className="grid grid-cols-2 gap-4">
              <button
                onClick={() => setRole('student')}
                className={`p-6 border-2 rounded-xl text-left transition-colors ${role === 'student' ? 'border-blue-600 bg-blue-50' : 'border-border hover:border-border'}`}
              >
                <div className="text-xl font-bold text-foreground mb-1">{t('onboarding.student')}</div>
                <div className="text-sm text-foreground-muted">{t('onboarding.studentDesc')}</div>
              </button>
              <button
                onClick={() => setRole('teacher')}
                className={`p-6 border-2 rounded-xl text-left transition-colors ${role === 'teacher' ? 'border-blue-600 bg-blue-50' : 'border-border hover:border-border'}`}
              >
                <div className="text-xl font-bold text-foreground mb-1">{t('onboarding.teacher')}</div>
                <div className="text-sm text-foreground-muted">{t('onboarding.teacherDesc')}</div>
              </button>
            </div>
            
            <button
              onClick={() => role && setStep(2)}
              disabled={!role}
              className="w-full mt-6 py-3 bg-blue-600 text-white rounded-xl font-medium disabled:opacity-50 disabled:cursor-not-allowed hover:bg-blue-700"
            >
              {t('onboarding.continue')}
            </button>
          </div>
        )}

        {step === 2 && role === 'student' && (
          <div className="space-y-6">
            <div>
              <h2 className="text-lg font-medium text-foreground-muted mb-2">{t('onboarding.gradeQuestion')}</h2>
              <select 
                value={grade}
                onChange={(e) => setGrade(Number(e.target.value))}
                className="w-full p-3 border border-border rounded-xl bg-surface focus:ring-2 focus:ring-blue-500 outline-none"
              >
                {[6, 7, 8, 9].map(g => (
                  <option key={g} value={g}>{t('onboarding.grade', { grade: g.toString() })}</option>
                ))}
              </select>
            </div>
            <div>
              <h2 className="text-lg font-medium text-foreground-muted mb-2">{t('onboarding.langQuestion')}</h2>
              <div className="flex gap-4">
                <label className="flex items-center gap-2">
                  <input type="radio" checked={language === 'en'} onChange={() => setLanguage('en')} /> English
                </label>
                <label className="flex items-center gap-2">
                  <input type="radio" checked={language === 'vi'} onChange={() => setLanguage('vi')} /> Tiếng Việt
                </label>
              </div>
            </div>
            <div className="flex gap-4 pt-4">
              <button onClick={() => setStep(1)} className="px-6 py-3 border border-border rounded-xl font-medium hover:bg-background">{t('onboarding.back')}</button>
              <button
                onClick={handleComplete}
                disabled={loading}
                className="flex-1 py-3 bg-blue-600 text-white rounded-xl font-medium disabled:opacity-50 hover:bg-blue-700"
              >
                {loading ? t('onboarding.creating') : t('onboarding.complete')}
              </button>
            </div>
          </div>
        )}

        {step === 2 && role === 'teacher' && (
          <div className="space-y-6">
            <div>
              <h2 className="text-lg font-medium text-foreground-muted mb-2">{t('onboarding.langQuestion')}</h2>
              <div className="flex gap-4">
                <label className="flex items-center gap-2">
                  <input type="radio" checked={language === 'en'} onChange={() => setLanguage('en')} /> English
                </label>
                <label className="flex items-center gap-2">
                  <input type="radio" checked={language === 'vi'} onChange={() => setLanguage('vi')} /> Tiếng Việt
                </label>
              </div>
            </div>
            <div className="flex gap-4 pt-4">
              <button onClick={() => setStep(1)} className="px-6 py-3 border border-border rounded-xl font-medium hover:bg-background">{t('onboarding.back')}</button>
              <button
                onClick={handleComplete}
                disabled={loading}
                className="flex-1 py-3 bg-blue-600 text-white rounded-xl font-medium disabled:opacity-50 hover:bg-blue-700"
              >
                {loading ? t('onboarding.creating') : t('onboarding.complete')}
              </button>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
