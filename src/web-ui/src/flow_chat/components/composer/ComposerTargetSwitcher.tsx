import { SegmentedControl } from '@/design-system';
import type { ChatInputTarget } from './model/composerState';

interface ComposerTargetSwitcherProps {
  label: string;
  mainLabel: string;
  btwLabel: string;
  currentSessionTitle: string;
  activeBtwSessionTitle: string;
  value: ChatInputTarget;
  onChange: (value: ChatInputTarget) => void;
}

export function ComposerTargetSwitcher({
  label,
  mainLabel,
  btwLabel,
  currentSessionTitle,
  activeBtwSessionTitle,
  value,
  onChange,
}: ComposerTargetSwitcherProps) {
  return (
    <div className="sparo-chat-input__target-switcher" data-testid="chat-input-target-switcher">
      <span className="sparo-chat-input__target-switcher-label">{label}</span>
      <SegmentedControl
        ariaLabel={label}
        className="sparo-chat-input__target-control"
        onChange={nextValue => onChange(nextValue as ChatInputTarget)}
        options={[
          {
            value: 'main',
            label: (
              <>
                {mainLabel}
                {value === 'main' && currentSessionTitle && (
                  <span className="sparo-chat-input__target-tab-name">{currentSessionTitle}</span>
                )}
              </>
            ),
          },
          {
            value: 'btw',
            label: (
              <>
                {btwLabel}
                {value === 'btw' && activeBtwSessionTitle && (
                  <span className="sparo-chat-input__target-tab-name">{activeBtwSessionTitle}</span>
                )}
              </>
            ),
          },
        ]}
        size="small"
        value={value}
      />
    </div>
  );
}
