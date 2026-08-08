import { AppShell } from '@/components/AppShell';
import { requireRole } from '@/lib/auth/require-role';

const NAV_LINKS = [
  { href: '/teacher', label: 'Dashboard' },
  { href: '/teacher/classrooms', label: 'Classrooms' },
  { href: '/teacher/settings', label: 'Settings' },
];

/**
 * Server-side gate for the teacher area. See the student layout for why this is
 * enforced on the server rather than in a client effect.
 */
export default async function TeacherLayout({ children }: { children: React.ReactNode }) {
  const session = await requireRole('teacher');

  return (
    <AppShell
      brandHref="/teacher"
      brandSuffix="for Teachers"
      navLinks={NAV_LINKS}
      displayName={session.displayName ?? 'Teacher'}
    >
      {children}
    </AppShell>
  );
}
