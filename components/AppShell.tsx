'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/components/providers/AuthProvider';

interface NavLink {
  href: string;
  label: string;
}

interface AppShellProps {
  brandHref: string;
  brandSuffix?: string;
  navLinks: NavLink[];
  displayName: string;
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
  children,
}: AppShellProps) {
  const { logout } = useAuth();
  const pathname = usePathname();

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:rounded-lg focus:bg-white focus:px-4 focus:py-2 focus:text-blue-700 focus:shadow"
      >
        Skip to main content
      </a>
      <header className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center gap-8">
              <Link href={brandHref} className="text-2xl font-bold text-gray-900">
                Think<span className="text-blue-600">First</span>
                {brandSuffix && (
                  <span className="text-sm font-normal text-gray-500"> {brandSuffix}</span>
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
                      className={`font-medium ${
                        active
                          ? 'text-blue-600 border-b-2 border-blue-600'
                          : 'text-gray-500 hover:text-gray-900'
                      } py-5`}
                    >
                      {link.label}
                    </Link>
                  );
                })}
              </nav>
            </div>
            <div className="flex items-center gap-4">
              <div className="text-sm font-medium text-gray-700 bg-gray-100 px-3 py-1.5 rounded-full">
                {displayName}
              </div>
              <button
                onClick={logout}
                className="text-sm font-medium text-red-600 hover:text-red-800"
              >
                Logout
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
