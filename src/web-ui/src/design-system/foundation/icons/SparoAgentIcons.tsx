import { forwardRef, type SVGProps } from 'react';

export interface SparoIconProps extends SVGProps<SVGSVGElement> {
  size?: number | string;
  strokeWidth?: number | string;
}

function resolveIconSize(size: number | string | undefined): number | string {
  return size ?? 16;
}

export const SparoAgentIcon = forwardRef<SVGSVGElement, SparoIconProps>(({
  size,
  strokeWidth = 1.8,
  ...props
}, ref) => {
  const iconSize = resolveIconSize(size);

  return (
    <svg
      ref={ref}
      width={iconSize}
      height={iconSize}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      xmlns="http://www.w3.org/2000/svg"
      {...props}
    >
      <rect x="4" y="3.5" width="16" height="17" rx="4.5" />
      <ellipse cx="12" cy="12" rx="4.4" ry="5.8" transform="rotate(24 12 12)" />
      <path d="M8.5 7.5h7" />
      <path d="M8.5 16.7h7" />
    </svg>
  );
});

SparoAgentIcon.displayName = 'SparoAgentIcon';

export const SparoSubagentIcon = forwardRef<SVGSVGElement, SparoIconProps>(({
  size,
  strokeWidth = 1.8,
  ...props
}, ref) => {
  const iconSize = resolveIconSize(size);

  return (
    <svg
      ref={ref}
      width={iconSize}
      height={iconSize}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      xmlns="http://www.w3.org/2000/svg"
      {...props}
    >
      <rect x="3.5" y="4.5" width="12.5" height="14" rx="3.6" />
      <ellipse cx="9.8" cy="11.6" rx="3" ry="4" transform="rotate(24 9.8 11.6)" />
      <path d="M16 11h1.6c1.4 0 2.6 1.1 2.6 2.5v.2" />
      <rect x="15.7" y="13.2" width="5.3" height="5.8" rx="1.7" />
    </svg>
  );
});

SparoSubagentIcon.displayName = 'SparoSubagentIcon';
