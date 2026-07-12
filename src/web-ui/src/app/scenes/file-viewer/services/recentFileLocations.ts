const RECENT_FILE_LOCATIONS_STORAGE_KEY = 'sparo.files.recentPaths';
export const MAX_RECENT_FILE_LOCATIONS = 12;

export function loadRecentFileLocations(): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const value: unknown = JSON.parse(
      window.localStorage.getItem(RECENT_FILE_LOCATIONS_STORAGE_KEY) || '[]',
    );
    if (!Array.isArray(value)) return [];

    return Array.from(new Set(value.filter((path): path is string => (
      typeof path === 'string' && path.trim().length > 0
    )))).slice(0, MAX_RECENT_FILE_LOCATIONS);
  } catch {
    return [];
  }
}

export function saveRecentFileLocations(paths: readonly string[]): void {
  if (typeof window === 'undefined') return;
  const normalized = Array.from(new Set(paths.filter((path) => path.trim().length > 0)))
    .slice(0, MAX_RECENT_FILE_LOCATIONS);
  window.localStorage.setItem(
    RECENT_FILE_LOCATIONS_STORAGE_KEY,
    JSON.stringify(normalized),
  );
}
