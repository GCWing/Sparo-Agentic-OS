import type { ReactNode } from 'react';

interface EditorialRowProps {
  index: string;
  title: string;
  description?: ReactNode;
  error?: string;
  control?: ReactNode;
  children?: ReactNode;
  /** Make title and control span full width below index */
  stacked?: boolean;
}

/**
 * VI §12.7 Editorial Row pattern.
 * Grid: [index mono] [title+desc] [control]
 */
export function EditorialRow({
  index,
  title,
  description,
  error,
  control,
  children,
  stacked = false,
}: EditorialRowProps) {
  return (
    <div className={`editorial-row${error ? ' editorial-row--error' : ''}`}>
      <span className="editorial-row__index">{index}</span>
      <div style={{ minWidth: 0 }}>
        <div className="editorial-row__title">{title}</div>
        {description && (
          <div className="editorial-row__desc">{description}</div>
        )}
        {error && (
          <div className="editorial-row__error">{error}</div>
        )}
        {stacked && children && (
          <div style={{ marginTop: 8 }}>{children}</div>
        )}
      </div>
      {!stacked && (control || children) && (
        <div className="editorial-row__control">
          {control ?? children}
        </div>
      )}
    </div>
  );
}
