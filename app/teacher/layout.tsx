import { AppShell } from '@/components/AppShell';
import { requireRole } from '@/lib/auth/require-role';
import { getTranslation } from '@/lib/i18n';

/**
 * Server-side gate for the teacher area. See the student layout for why this is
 * enforced on the server rather than in a client effect.
 */
export default async function TeacherLayout({ children }: { children: React.ReactNode }) {
  const session = await requireRole('teacher');
  const { t } = getTranslation(session.preferredLanguage ?? 'en');

  const NAV_LINKS = [
    { href: '/teacher', label: t('common.dashboard') },
    { href: '/teacher/classrooms', label: t('common.classrooms') },
    { href: '/teacher/settings', label: t('common.settings') },
    { href: '/teacher/guide', label: t('common.guide') },
  ];

  return (
    <AppShell
      brandHref="/teacher"
      brandSuffix={t('common.forTeachers')}
      navLinks={NAV_LINKS}
      displayName={session.displayName ?? 'Teacher'}
      logoutLabel={t('common.logout')}
      skipToMainLabel={t('common.skipToMain')}
    >
      {children}
    </AppShell>
  );
}
