import { AppShell } from '@/components/AppShell';
import { requireRole } from '@/lib/auth/require-role';

const NAV_LINKS = [
  { href: '/student', label: 'Dashboard' },
  { href: '/student/session', label: 'Sessions' },
  { href: '/student/progress', label: 'Progress' },
  { href: '/student/settings', label: 'Settings' },
];

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

  return (
    <AppShell
      brandHref="/student"
      navLinks={NAV_LINKS}
      displayName={session.displayName ?? 'Student'}
    >
      {children}
    </AppShell>
  );
}
