import type React from 'react';
import { Badge, SelectableRow } from '@/design-system';
import { useMovingHoverHighlight } from '@/shared/hooks/useMovingHoverHighlight';
import type { ComposerCommandOption } from './model/composerCommandRegistry';
import type { ComposerCommandInteractionState } from './model/composerState';

interface ComposerCommandPickerLabels {
  commands: string;
  selectHint: string;
  noMatchingCommand: string;
  loadingMcpPrompts: string;
  current: string;
}

interface ComposerCommandPickerProps {
  state: ComposerCommandInteractionState;
  options: ComposerCommandOption[];
  mcpPromptCommandsLoading: boolean;
  labels: ComposerCommandPickerLabels;
  onSelectOption: (option: ComposerCommandOption) => void;
  onHoverIndex: (index: number) => void;
}

export function ComposerCommandPicker({
  state,
  options,
  mcpPromptCommandsLoading,
  labels,
  onSelectOption,
  onHoverIndex,
}: ComposerCommandPickerProps) {
  const commandHover = useMovingHoverHighlight<HTMLDivElement>();

  if (!state.isOpen) {
    return null;
  }

  const renderHoverHighlight = () => (
    <div
      className={`sparo-chat-input__slash-command-hover-highlight ${commandHover.highlight.visible ? 'sparo-chat-input__slash-command-hover-highlight--visible' : ''}`}
      style={{
        '--sparo-slash-hover-top': `${commandHover.highlight.top}px`,
        '--sparo-slash-hover-left': `${commandHover.highlight.left}px`,
        '--sparo-slash-hover-width': `${commandHover.highlight.width}px`,
        '--sparo-slash-hover-height': `${commandHover.highlight.height}px`,
        '--sparo-slash-hover-stretch-x': commandHover.highlight.stretchX,
        '--sparo-slash-hover-stretch-y': commandHover.highlight.stretchY,
      } as React.CSSProperties}
    />
  );

  const getItemHoverHandlers = (index: number) => ({
    onMouseEnter: (event: React.MouseEvent<HTMLElement>) => {
      commandHover.updateHighlight(event.currentTarget);
      onHoverIndex(index);
    },
    onPointerEnter: (event: React.PointerEvent<HTMLElement>) => {
      commandHover.updateHighlight(event.currentTarget);
    },
  });

  let lastGroup = '';

  return (
    <div className="sparo-chat-input__slash-command-picker">
      <div className="sparo-chat-input__slash-command-header">
        <span>{labels.commands}</span>
        <span className="sparo-chat-input__slash-command-hint">{labels.selectHint}</span>
      </div>
      <div
        ref={commandHover.surfaceRef}
        className="sparo-chat-input__slash-command-list sparo-chat-input__slash-command-list--motion"
        {...commandHover.getSurfaceHandlers('.sparo-chat-input__slash-command-item')}
      >
        {renderHoverHighlight()}
        {mcpPromptCommandsLoading && options.length === 0 ? (
          <div className="sparo-chat-input__slash-command-empty">
            {labels.loadingMcpPrompts}
          </div>
        ) : options.length > 0 ? (
          options.map((option, index) => {
            const shouldRenderGroup = option.groupLabel !== lastGroup;
            lastGroup = option.groupLabel;

            return (
              <div key={option.id} className="sparo-chat-input__slash-command-entry">
                {shouldRenderGroup && (
                  <div className="sparo-chat-input__slash-command-group">
                    {option.groupLabel}
                  </div>
                )}
                <SelectableRow
                  className={`sparo-chat-input__slash-command-item ${index === state.selectedIndex ? 'sparo-chat-input__slash-command-item--selected' : ''} ${option.current ? 'sparo-chat-input__slash-command-item--active' : ''}`}
                  data-testid={`composer-command-${option.id}`}
                  description={(
                    <span className="sparo-chat-input__slash-command-label">
                      {option.description}
                    </span>
                  )}
                  meta={option.current ? <Badge className="sparo-chat-input__slash-command-current" variant="accent">{labels.current}</Badge> : undefined}
                  onClick={() => onSelectOption(option)}
                  {...getItemHoverHandlers(index)}
                  selected={index === state.selectedIndex}
                  title={(
                    <span className="sparo-chat-input__slash-command-name">
                      {option.command}
                    </span>
                  )}
                />
              </div>
            );
          })
        ) : (
          <div className="sparo-chat-input__slash-command-empty">
            {labels.noMatchingCommand}
          </div>
        )}
      </div>
    </div>
  );
}
