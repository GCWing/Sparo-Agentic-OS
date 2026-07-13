import { forwardRef, type SVGProps } from 'react';

export interface SparoLogoMarkProps extends SVGProps<SVGSVGElement> {
  size?: number | string;
  strokeWidth?: number | string;
}

export const SparoLogoMark = forwardRef<SVGSVGElement, SparoLogoMarkProps>(({
  size = 24,
  strokeWidth = 6.5,
  ...props
}, ref) => (
  <svg
    ref={ref}
    width={size}
    height={size}
    viewBox="-3 -3 88 106"
    fill="none"
    stroke="currentColor"
    strokeWidth={strokeWidth}
    strokeLinecap="round"
    strokeLinejoin="round"
    xmlns="http://www.w3.org/2000/svg"
    focusable="false"
    {...props}
  >
    <path d="M52.3 2.7C40.8 4.9 25.5 13.4 16.4 24.8C6.3 37.6 1.4 52.7 2.8 66.9C4.4 82.5 12.9 94.2 25.7 98.1C39.1 102.2 53.2 95.4 63.9 84.5C75.7 72.3 82.2 55.2 79.2 42.3C77.4 34.4 73.3 29.4 67.6 24.7C61.4 19.5 58.6 15 57.7 8.5C56.9 3.3 55 2.2 52.3 2.7Z" />
    <path d="M52.4 34.4C44.2 33.2 35.5 41 31.2 52.2C26.4 64.7 28.9 74.2 35.9 76.6C43.4 79.1 52.3 72.2 56.6 62.3C61 52.2 60.4 41.8 55 36.5C54.1 35.6 53.2 34.9 52.4 34.4Z" />
  </svg>
));

SparoLogoMark.displayName = 'SparoLogoMark';
