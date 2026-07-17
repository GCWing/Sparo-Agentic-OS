import { useState } from 'react';
import type { JsonValue } from '../catalog/types';
import type { SettingRendererFieldProps } from './types';
import { StringSettingRenderer } from './StringSettingRenderer';

export interface JsonSettingRendererProps extends SettingRendererFieldProps<JsonValue> {
  conflictMessage?: string;
  invalidJsonMessage: string;
  onDirtyChange?: (dirty: boolean) => void;
}

export function JsonSettingRenderer({
  value,
  onChange,
  invalidJsonMessage,
  errorMessage,
  onError,
  ...props
}: JsonSettingRendererProps) {
  const [parseError, setParseError] = useState<string | undefined>();

  return (
    <StringSettingRenderer
      {...props}
      multiline
      value={JSON.stringify(value, null, 2)}
      errorMessage={parseError ?? errorMessage}
      onError={onError}
      onChange={async (draft) => {
        let parsed: JsonValue;
        try {
          parsed = JSON.parse(draft) as JsonValue;
        } catch {
          setParseError(invalidJsonMessage);
          throw new Error(invalidJsonMessage);
        }
        setParseError(undefined);
        await onChange(parsed);
      }}
    />
  );
}
