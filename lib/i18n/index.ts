import { en } from './locales/en';
import { vi } from './locales/vi';

export type Language = 'en' | 'vi';

export function getDictionary(lang: Language) {
  return lang === 'vi' ? vi : en;
}

export function translate(dict: any, key: string, params?: Record<string, string | number>) {
  const keys = key.split('.');
  let value: any = dict;
  for (const k of keys) {
    if (value === undefined) break;
    value = value[k];
  }
  if (value === undefined) {
    // fallback to en
    let fallbackValue: any = en;
    for (const k of keys) {
      if (fallbackValue === undefined) break;
      fallbackValue = fallbackValue[k];
    }
    value = fallbackValue;
  }
  
  if (typeof value === 'string' && params) {
    return Object.entries(params).reduce(
      (acc, [k, v]) => acc.replace(new RegExp(`\\{\\{${k}\\}\\}`, 'g'), String(v)),
      value
    );
  }
  
  return value || key;
}

export function getTranslation(lang: Language) {
  const dict = getDictionary(lang);
  return {
    t: (key: string, params?: Record<string, string | number>) => translate(dict, key, params),
    lang
  };
}
