import React, { useCallback, useMemo, useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/design-system';
import './ToolJsonPreview.scss';

const DEFAULT_MAX_CHARS = 4000;
const SENSITIVE_FIELD_PATTERN = /(token|password|secret|api[_-]?key|authorization|credential)/i;

function redactSensitive(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(redactSensitive);
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, nested]) => [
        key,
        SENSITIVE_FIELD_PATTERN.test(key) ? '[redacted]' : redactSensitive(nested),
      ])
    );
  }

  return value;
}

function stringify(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }

  try {
    return JSON.stringify(redactSensitive(value), null, 2);
  } catch {
    return String(value);
  }
}

export interface ToolJsonPreviewProps {
  value: unknown;
  maxChars?: number;
  className?: string;
}

export const ToolJsonPreview: React.FC<ToolJsonPreviewProps> = ({
  value,
  maxChars = DEFAULT_MAX_CHARS,
  className = '',
}) => {
  const { t } = useTranslation('flow-chat');
  const [copied, setCopied] = useState(false);

  const fullContent = useMemo(() => stringify(value), [value]);
  const isTruncated = fullContent.length > maxChars;
  const content = useMemo(() => {
    const text = fullContent;
    if (text.length <= maxChars) {
      return text;
    }
    return `${text.slice(0, maxChars)}\n...`;
  }, [fullContent, maxChars]);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(fullContent);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch {
      setCopied(false);
    }
  }, [fullContent]);

  return (
    <div className={['tool-json-preview-shell', className].filter(Boolean).join(' ')}>
      <div className="tool-json-preview-shell__toolbar">
        {isTruncated && (
          <span className="tool-json-preview-shell__truncated">
            {t('toolCards.common.truncated', { defaultValue: 'Truncated' })}
          </span>
        )}
        <Button
          variant="secondary"
          size="small"
          onClick={handleCopy}
          aria-label={t('toolCards.common.copyJson', { defaultValue: 'Copy JSON' })}
          title={t('toolCards.common.copyJson', { defaultValue: 'Copy JSON' })}
        >
          {copied ? <Check size={12} /> : <Copy size={12} />}
          <span>
            {copied
              ? t('toolCards.common.copied', { defaultValue: 'Copied' })
              : t('toolCards.common.copy', { defaultValue: 'Copy' })}
          </span>
        </Button>
      </div>
      <pre className="tool-json-preview">
        {content}
      </pre>
    </div>
  );
};
