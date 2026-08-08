import { AppShell } from '@/components/AppShell';
import { requireRole } from '@/lib/auth/require-role';
import { getTranslation } from '@/lib/i18n';

/**
 * Server-side gate for the student area.
 *
 * `requireRole` runs before this layout renders, so a teacher, an unauthenticated
 * visitor, or a caller the server cannot verify is redirected without receiving
 * any student markup. The previous implementation redirected from a client
 * `useEffect`, which changed only what was painted.
 */
export default async function StudentLayout({ children }: { children: React.ReactNode }) {
  const session = await requireRole('student');
  const { t } = getTranslation(session.preferredLanguage ?? 'en');

  const NAV_LINKS = [
    { href: '/student', label: t('common.dashboard') },
    { href: '/student/session', label: t('common.sessions') },
    { href: '/student/progress', label: t('common.progress') },
    { href: '/student/settings', label: t('common.settings') },
    { href: '/student/guide', label: t('common.guide') },
  ];

  return (
    <AppShell
      brandHref="/student"
      navLinks={NAV_LINKS}
      displayName={session.displayName ?? 'Student'}
      logoutLabel={t('common.logout')}
      skipToMainLabel={t('common.skipToMain')}
    >
      {children}
    </AppShell>
  );
}
