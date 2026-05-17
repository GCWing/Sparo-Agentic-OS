import { Badge, SelectableRow } from '@/design-system';
import type { ModeInfo } from '../../reducers/modeReducer';
import type { SlashActionItem, SlashPickerItem, SlashMcpPromptItem } from './model/composerCommands';

export interface ComposerCommandPickerState {
  isActive: boolean;
  kind: 'modes' | 'actions' | 'all';
  selectedIndex: number;
}

interface ComposerCommandPickerLabels {
  quickAction: string;
  commands: string;
  addModeMenuTitle: string;
  selectHint: string;
  noMatchingCommand: string;
  noMatchingMode: string;
  loadingMcpPrompts: string;
  current: string;
}

interface ComposerCommandPickerProps {
  state: ComposerCommandPickerState;
  canSwitchModes: boolean;
  currentMode: string;
  mcpPromptCommandsLoading: boolean;
  labels: ComposerCommandPickerLabels;
  actions: SlashActionItem[];
  allItems: SlashPickerItem[];
  filteredModes: ModeInfo[];
  onSelectAction: (id: string) => void;
  onSelectMode: (id: string) => void;
  onSelectPrompt: (item: SlashMcpPromptItem) => void;
  onHoverIndex: (index: number) => void;
}

export function ComposerCommandPicker({
  state,
  canSwitchModes,
  currentMode,
  mcpPromptCommandsLoading,
  labels,
  actions,
  allItems,
  filteredModes,
  onSelectAction,
  onSelectMode,
  onSelectPrompt,
  onHoverIndex,
}: ComposerCommandPickerProps) {
  if (!state.isActive) {
    return null;
  }

  if (state.kind === 'actions') {
    return (
      <div className="sparo-chat-input__slash-command-picker">
        <div className="sparo-chat-input__slash-command-header">
          <span>{labels.quickAction}</span>
          <span className="sparo-chat-input__slash-command-hint">{labels.selectHint}</span>
        </div>
        <div className="sparo-chat-input__slash-command-list">
          {actions.length > 0 ? (
            actions.map((action, index) => (
              <SelectableRow
                key={action.id}
                className={`sparo-chat-input__slash-command-item ${index === state.selectedIndex ? 'sparo-chat-input__slash-command-item--selected' : ''}`}
                description={<span className="sparo-chat-input__slash-command-label">{action.label}</span>}
                onClick={() => onSelectAction(action.id)}
                onMouseEnter={() => onHoverIndex(index)}
                selected={index === state.selectedIndex}
                title={<span className="sparo-chat-input__slash-command-name">{action.command}</span>}
              />
            ))
          ) : (
            <div className="sparo-chat-input__slash-command-empty">
              {labels.noMatchingCommand}
            </div>
          )}
        </div>
      </div>
    );
  }

  if (state.kind === 'all') {
    return (
      <div className="sparo-chat-input__slash-command-picker">
        <div className="sparo-chat-input__slash-command-header">
          <span>{labels.commands}</span>
          <span className="sparo-chat-input__slash-command-hint">{labels.selectHint}</span>
        </div>
        <div className="sparo-chat-input__slash-command-list">
          {mcpPromptCommandsLoading && allItems.length === 0 ? (
            <div className="sparo-chat-input__slash-command-empty">
              {labels.loadingMcpPrompts}
            </div>
          ) : allItems.length > 0 ? (
            allItems.map((item, index) => {
              const isMode = item.kind === 'mode';
              const isActiveMode = isMode && item.id === currentMode;
              return (
                <SelectableRow
                  key={`${item.kind}-${item.id}`}
                  className={`sparo-chat-input__slash-command-item ${index === state.selectedIndex ? 'sparo-chat-input__slash-command-item--selected' : ''} ${isActiveMode ? 'sparo-chat-input__slash-command-item--active' : ''}`}
                  description={(
                    <span className="sparo-chat-input__slash-command-label">
                      {isMode
                        ? item.name
                        : item.kind === 'mcpPrompt'
                          ? `${item.serverName} / ${item.label}`
                          : item.label}
                    </span>
                  )}
                  meta={isActiveMode ? <Badge className="sparo-chat-input__slash-command-current" variant="accent">{labels.current}</Badge> : undefined}
                  onClick={() => {
                    if (item.kind === 'mode') {
                      onSelectMode(item.id);
                    } else if (item.kind === 'mcpPrompt') {
                      onSelectPrompt(item);
                    } else {
                      onSelectAction(item.id);
                    }
                  }}
                  onMouseEnter={() => onHoverIndex(index)}
                  selected={index === state.selectedIndex}
                  title={(
                    <span className="sparo-chat-input__slash-command-name">
                      {isMode ? `/${item.id}` : item.command}
                    </span>
                  )}
                />
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

  if (!canSwitchModes) {
    return null;
  }

  return (
    <div className="sparo-chat-input__slash-command-picker">
      <div className="sparo-chat-input__slash-command-header">
        <span>{labels.addModeMenuTitle}</span>
        <span className="sparo-chat-input__slash-command-hint">{labels.selectHint}</span>
      </div>
      <div className="sparo-chat-input__slash-command-list">
        {filteredModes.length > 0 ? (
          filteredModes.map((mode, index) => (
            <SelectableRow
              key={mode.id}
              className={`sparo-chat-input__slash-command-item ${index === state.selectedIndex ? 'sparo-chat-input__slash-command-item--selected' : ''} ${mode.id === currentMode ? 'sparo-chat-input__slash-command-item--active' : ''}`}
              description={<span className="sparo-chat-input__slash-command-label">{mode.name}</span>}
              meta={mode.id === currentMode ? <Badge className="sparo-chat-input__slash-command-current" variant="accent">{labels.current}</Badge> : undefined}
              onClick={() => onSelectMode(mode.id)}
              onMouseEnter={() => onHoverIndex(index)}
              selected={index === state.selectedIndex}
              title={<span className="sparo-chat-input__slash-command-name">/{mode.id}</span>}
            />
          ))
        ) : (
          <div className="sparo-chat-input__slash-command-empty">
            {labels.noMatchingMode}
          </div>
        )}
      </div>
    </div>
  );
}
