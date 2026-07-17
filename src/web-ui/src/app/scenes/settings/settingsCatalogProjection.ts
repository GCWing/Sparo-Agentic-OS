import type { SettingDescriptor } from '@/infrastructure/config';

/** Manual settings include development-time advanced fallbacks from Catalog. */
export function isManualSettingVisible(descriptor: SettingDescriptor): boolean {
  return !descriptor.presentation.hidden;
}
