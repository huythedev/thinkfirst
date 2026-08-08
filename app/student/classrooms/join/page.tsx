'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/components/providers/AuthProvider';
import { useTranslation } from '@/lib/i18n/client';

/**
 * Classroom join flow.
 *
 * The code is resolved through `classroomJoinCodes`, a lookup collection keyed by
 * the code. Security rules permit `get` and deny `list` there, so knowing a code
 * is what grants access and no client can enumerate classrooms.
 *
 * The membership document id is `<classroomId>__<uid>`. That is not cosmetic:
 * the rules resolve membership by looking that id up directly, because rules
 * cannot run queries.
 */
export default function JoinClassroomPage() {
  const router = useRouter();
  const { user } = useAuth();
  const { t } = useTranslation();

  const [code, setCode] = useState('');
  const [status, setStatus] = useState<'idle' | 'joining'>('idle');
  const [error, setError] = useState('');

  const normalizedCode = code.trim().toUpperCase();

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!user) return;

    if (normalizedCode.length === 0) {
      setError(t('joinClassroom.emptyError'));
      return;
    }

    setStatus('joining');
    setError('');

    try {
      const response = await fetch('/api/classrooms/join', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ code: normalizedCode }),
      });

      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(typeof result.error === 'string' ? result.error : t('joinClassroom.error'));
        setStatus('idle');
        return;
      }

      router.push('/student');
    } catch (err) {
      console.error('Failed to join classroom', err);
      setError(t('joinClassroom.error'));
      setStatus('idle');
    }
  };

  return (
    <div className="max-w-md mx-auto bg-surface rounded-2xl shadow-sm border border-border p-8">
      <div className="flex items-center gap-4 mb-6">
        <Link href="/student" className="text-foreground-muted hover:text-foreground">
          &larr; {t('joinClassroom.back')}
        </Link>
        <h1 className="text-2xl font-bold text-foreground">{t('joinClassroom.title')}</h1>
      </div>

      <p className="text-foreground-muted mb-6">
        {t('joinClassroom.desc')}
      </p>

      {error && (
        <div role="alert" className="mb-6 p-4 bg-red-50 text-red-700 rounded-xl text-sm">
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-6">
        <div>
          <label htmlFor="join-code" className="block text-sm font-medium text-foreground-muted mb-2">
            {t('joinClassroom.codeLabel')}
          </label>
          <input
            id="join-code"
            value={code}
            onChange={(event) => setCode(event.target.value)}
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            placeholder={t('joinClassroom.codePlaceholder')}
            className="w-full p-3 border border-border rounded-xl font-mono tracking-widest uppercase outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        <button
          type="submit"
          disabled={status === 'joining' || normalizedCode.length === 0}
          className="w-full px-6 py-3 bg-blue-600 text-white font-medium rounded-xl hover:bg-blue-700 disabled:opacity-50"
        >
          {status === 'joining' ? t('joinClassroom.joining') : t('joinClassroom.joinBtn')}
        </button>
      </form>
    </div>
  );
}
