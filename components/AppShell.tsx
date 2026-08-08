'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/components/providers/AuthProvider';
import { ThemeToggle } from '@/components/ThemeToggle';

interface NavLink {
  href: string;
  label: string;
}

interface AppShellProps {
  brandHref: string;
  brandSuffix?: string;
  navLinks: NavLink[];
  displayName: string;
  logoutLabel?: string;
  skipToMainLabel?: string;
  children: React.ReactNode;
}

/**
 * Shared application chrome for the signed-in areas.
 *
 * This is a client component only because it needs the logout handler and the
 * active-path highlight. Authorization is decided by the server layout that
 * renders it, and `displayName` is passed down from the verified server session
 * so the header does not wait on a client profile fetch.
 */
export function AppShell({
  brandHref,
  brandSuffix,
  navLinks,
  displayName,
  logoutLabel = 'Logout',
  skipToMainLabel = 'Skip to main content',
  children,
}: AppShellProps) {
  const { logout } = useAuth();
  const pathname = usePathname();

  return (
    <div className="min-h-screen bg-background flex flex-col theme-transition">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:rounded-lg focus:bg-surface focus:px-4 focus:py-2 focus:text-blue-700 focus:shadow dark:focus:bg-gray-900 dark:focus:text-blue-400"
      >
        {skipToMainLabel}
      </a>
      <header className="bg-navbar-background backdrop-blur-md border-b border-navbar-border sticky top-0 z-10 theme-transition">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center gap-8">
              <Link href={brandHref} className="text-2xl font-bold text-navbar-foreground theme-transition">
                Think<span className="text-blue-500">First</span>
                {brandSuffix && (
                  <span className="text-sm font-normal text-navbar-muted"> {brandSuffix}</span>
                )}
              </Link>
              <nav className="hidden md:flex gap-6" aria-label="Main">
                {navLinks.map((link) => {
                  const active =
                    pathname === link.href ||
                    (link.href !== brandHref && pathname.startsWith(link.href));
                  return (
                    <Link
                      key={link.href}
                      href={link.href}
                      aria-current={active ? 'page' : undefined}
                      className={`font-medium theme-transition ${
                        active
                          ? 'text-navbar-active border-b-2 border-navbar-active'
                          : 'text-navbar-muted hover:text-navbar-foreground'
                      } py-5`}
                    >
                      {link.label}
                    </Link>
                  );
                })}
              </nav>
            </div>
            <div className="flex items-center gap-4">
              <ThemeToggle />
              <div className="text-sm font-medium text-navbar-foreground bg-navbar-chip hover:bg-navbar-chip-hover border border-navbar-border px-3 py-1.5 rounded-full theme-transition">
                {displayName}
              </div>
              <button
                onClick={logout}
                className="text-sm font-medium text-red-400 hover:text-red-300 theme-transition"
              >
                {logoutLabel}
              </button>
            </div>
          </div>
        </div>
      </header>
      <main id="main-content" className="flex-1 w-full max-w-7xl mx-auto px-4 py-8">
        {children}
      </main>
    </div>
  );
}
