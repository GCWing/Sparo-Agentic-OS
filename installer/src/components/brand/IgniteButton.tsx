import type { ButtonHTMLAttributes, ReactNode } from 'react';

interface IgniteButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  loading?: boolean;
  children: ReactNode;
}

/** Primary installer action: ink background with a print-red leading dot. */
export function IgniteButton({ loading, children, style, ...rest }: IgniteButtonProps) {
  return (
    <button type="button" className="btn btn--ignite" style={{ justifyContent: 'center', ...style }} {...rest}>
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
