import { I18N_NAMESPACES, LOCALE_IDS } from '../constants';
import type { LocaleId, LocaleMetadata } from '../types';

export const DEFAULT_LOCALE: LocaleId = 'zh-CN';

export const DEFAULT_FALLBACK_LOCALE: LocaleId = 'en-US';

export const builtinLocales: LocaleMetadata[] = [
  {
    id: 'zh-CN',
    name: '简体中文',
    englishName: 'Simplified Chinese',
    nativeName: '简体中文',
    rtl: false,
    dateFormat: 'YYYY年M月D日',
    numberFormat: {
      decimal: '.',
      thousands: ',',
    },
    builtin: true,
  },
  {
    id: 'en-US',
    name: 'English',
    englishName: 'English (US)',
    nativeName: 'English',
    rtl: false,
    dateFormat: 'MM/DD/YYYY',
    numberFormat: {
      decimal: '.',
      thousands: ',',
    },
    builtin: true,
  },
];

export function getLocaleMetadata(localeId: LocaleId): LocaleMetadata | undefined {
  return builtinLocales.find((locale) => locale.id === localeId);
}

export function isLocaleSupported(localeId: string): localeId is LocaleId {
  return LOCALE_IDS.includes(localeId as LocaleId);
}

export function getSupportedLocaleIds(): LocaleId[] {
  return [...LOCALE_IDS];
}

export const DEFAULT_NAMESPACE = 'common';

export const ALL_NAMESPACES = I18N_NAMESPACES;
