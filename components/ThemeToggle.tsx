'use client';

import { useTheme } from 'next-themes';
import { useEffect, useState } from 'react';
import { Moon, Sun } from 'lucide-react';
import { useAuth } from './providers/AuthProvider';

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const { profile } = useAuth();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return <div className="w-9 h-9 rounded-md" />;
  }

  const lang = profile?.preferredLanguage === 'vi' ? 'vi' : 'en';
  
  const ariaLabel = lang === 'vi' 
    ? (theme === 'dark' ? 'Chuyển sang giao diện sáng' : 'Chuyển sang giao diện tối')
    : (theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode');

  return (
    <button
      onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
      className="p-2 rounded-md text-navbar-muted hover:text-navbar-foreground hover:bg-navbar-chip theme-transition focus:outline-none focus:ring-2 focus:ring-navbar-active"
      aria-label={ariaLabel}
      title={ariaLabel}
    >
      {theme === 'dark' ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
    </button>
  );
}
