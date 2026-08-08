import fs from 'fs';
const content = fs.readFileSync('components/AppShell.tsx', 'utf-8');
const newHeader = `<header className="bg-navbar-background backdrop-blur-md border-b border-navbar-border sticky top-0 z-10 theme-transition">
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
                      className={\`font-medium theme-transition \${
                        active
                          ? 'text-navbar-active border-b-2 border-navbar-active'
                          : 'text-navbar-muted hover:text-navbar-foreground'
                      } py-5\`}
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
      </header>`;
const startIdx = content.indexOf('<header');
const endIdx = content.indexOf('</header>') + '</header>'.length;
fs.writeFileSync('components/AppShell.tsx', content.substring(0, startIdx) + newHeader + content.substring(endIdx));
