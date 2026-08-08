'use client';
import { useAuth } from '@/components/providers/AuthProvider';
import { getTranslation } from './index';

export function useTranslation() {
  const { profile } = useAuth();
  const lang = profile?.preferredLanguage === 'vi' ? 'vi' : 'en';
  return getTranslation(lang);
}
