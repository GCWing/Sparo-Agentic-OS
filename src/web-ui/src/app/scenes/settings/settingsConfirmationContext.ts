import { createContext, useContext } from 'react';
import type { ConfigConfirmationRequiredError } from '@/infrastructure/config';

export type ConfirmationRequester = (
  error: ConfigConfirmationRequiredError,
) => Promise<boolean>;

export const SettingsConfirmationContext = createContext<ConfirmationRequester | null>(null);

export function useSettingsConfirmation(): ConfirmationRequester {
  const requestConfirmation = useContext(SettingsConfirmationContext);
  if (!requestConfirmation) {
    throw new Error('Settings confirmation must be requested inside SettingsConfirmationHost');
  }
  return requestConfirmation;
}
