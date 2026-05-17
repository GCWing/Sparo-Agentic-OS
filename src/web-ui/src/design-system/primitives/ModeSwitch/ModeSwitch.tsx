import { forwardRef } from 'react';
import { SegmentedControl, type SegmentedControlProps } from '../SegmentedControl';
import './ModeSwitch.scss';

export type ModeSwitchProps = Omit<SegmentedControlProps, 'size'>;

export const ModeSwitch = forwardRef<HTMLDivElement, ModeSwitchProps>(({
  ariaLabel,
  className = '',
  disabled = false,
  onChange,
  options,
  value,
  ...props
}, ref) => (
  <SegmentedControl
    ref={ref}
    ariaLabel={ariaLabel}
    className={['ds-mode-switch', className].filter(Boolean).join(' ')}
    disabled={disabled}
    onChange={onChange}
    options={options}
    size="small"
    value={value}
    {...props}
  />
));

ModeSwitch.displayName = 'ModeSwitch';
