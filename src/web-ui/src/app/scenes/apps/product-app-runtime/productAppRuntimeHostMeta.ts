import type { ProductAppHostSurfaceMeta } from '@/infrastructure/api/service-api/ProductAppRuntimeHostAPI';

export interface ResolvedProductAppHostSurfaceMeta {
  name: string;
  description: string;
  tags: string[];
}

function localeCandidates(locale?: string): string[] {
  const normalized = locale?.replace('_', '-');
  const languageFallback = normalized?.toLowerCase().startsWith('zh')
    ? 'zh-CN'
    : normalized?.toLowerCase().startsWith('en')
      ? 'en-US'
      : undefined;
  const values = [locale, normalized, languageFallback, 'en-US', 'zh-CN']
    .filter((value): value is string => Boolean(value));
  return Array.from(new Set(values));
}

export function resolveProductAppHostSurfaceMeta(
  app: ProductAppHostSurfaceMeta,
  locale?: string,
): ResolvedProductAppHostSurfaceMeta {
  const locales = app.i18n?.locales ?? {};
  const localized = localeCandidates(locale)
    .map((candidate) => locales[candidate])
    .find(Boolean);

  return {
    name: localized?.name?.trim() || app.name,
    description: localized?.description?.trim() || app.description,
    tags: localized?.tags?.length ? localized.tags : app.tags,
  };
}
