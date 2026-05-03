import type { ButtonHTMLAttributes, ReactNode } from 'react';

interface IgniteButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  loading?: boolean;
  dark?: boolean;
  secondary?: boolean;
  children: ReactNode;
}

/**
 * VI §12.8 primary button: ink bg + white text + print-red leading dot.
 * On dark surfaces (Act 4), use dark=true for white-bg variant.
 * secondary=true renders hairline-border variant.
 */
export function IgniteButton({ loading, dark, secondary, children, style, ...rest }: IgniteButtonProps) {
  const cls = secondary
    ? (dark ? 'btn btn--dark-secondary' : 'btn')
    : (dark ? 'btn btn--dark-primary' : 'btn btn--ignite');

  return (
    <button type="button" className={cls} style={{ justifyContent: 'center', ...style }} {...rest}>
      {loading && (
        <span
          style={{
            display: 'inline-block',
            width: 6, height: 6,
            borderRadius: '50%',
            border: '1.5px solid currentColor',
            borderTopColor: 'transparent',
            animation: 'spin 0.8s linear infinite',
            flexShrink: 0,
          }}
        />
      )}
      {children}
    </button>
  );
}
