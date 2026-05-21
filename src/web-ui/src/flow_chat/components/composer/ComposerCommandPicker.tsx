import { Badge, SelectableRow } from '@/design-system';
import type { AgentInfo } from '../../reducers/agentReducer';
import type { SlashActionItem, SlashPickerItem, SlashMcpPromptItem } from './model/composerCommands';

export interface ComposerCommandPickerState {
  isActive: boolean;
  kind: 'agents' | 'actions' | 'all';
  selectedIndex: number;
}

interface ComposerCommandPickerLabels {
  quickAction: string;
  commands: string;
  addAgentMenuTitle: string;
  selectHint: string;
  noMatchingCommand: string;
  noMatchingAgent: string;
  loadingMcpPrompts: string;
  current: string;
}

interface ComposerCommandPickerProps {
  state: ComposerCommandPickerState;
  canSwitchAgents: boolean;
  currentAgent: string;
  mcpPromptCommandsLoading: boolean;
  labels: ComposerCommandPickerLabels;
  actions: SlashActionItem[];
  allItems: SlashPickerItem[];
  filteredAgents: AgentInfo[];
  onSelectAction: (id: string) => void;
  onSelectAgent: (id: string) => void;
  onSelectPrompt: (item: SlashMcpPromptItem) => void;
  onHoverIndex: (index: number) => void;
}

export function ComposerCommandPicker({
  state,
  canSwitchAgents,
  currentAgent,
  mcpPromptCommandsLoading,
  labels,
  actions,
  allItems,
  filteredAgents,
  onSelectAction,
  onSelectAgent,
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
              const isAgent = item.kind === 'agent';
              const isActiveMode = isAgent && item.id === currentAgent;
              return (
                <SelectableRow
                  key={`${item.kind}-${item.id}`}
                  className={`sparo-chat-input__slash-command-item ${index === state.selectedIndex ? 'sparo-chat-input__slash-command-item--selected' : ''} ${isActiveMode ? 'sparo-chat-input__slash-command-item--active' : ''}`}
                  description={(
                    <span className="sparo-chat-input__slash-command-label">
                      {isAgent
                        ? item.name
                        : item.kind === 'mcpPrompt'
                          ? `${item.serverName} / ${item.label}`
                          : item.label}
                    </span>
                  )}
                  meta={isActiveMode ? <Badge className="sparo-chat-input__slash-command-current" variant="accent">{labels.current}</Badge> : undefined}
                  onClick={() => {
                    if (item.kind === 'agent') {
                      onSelectAgent(item.id);
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
                      {isAgent ? `/${item.id}` : item.command}
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

  if (!canSwitchAgents) {
    return null;
  }

  return (
    <div className="sparo-chat-input__slash-command-picker">
      <div className="sparo-chat-input__slash-command-header">
        <span>{labels.addAgentMenuTitle}</span>
        <span className="sparo-chat-input__slash-command-hint">{labels.selectHint}</span>
      </div>
      <div className="sparo-chat-input__slash-command-list">
        {filteredAgents.length > 0 ? (
          filteredAgents.map((agent, index) => (
            <SelectableRow
              key={agent.id}
              className={`sparo-chat-input__slash-command-item ${index === state.selectedIndex ? 'sparo-chat-input__slash-command-item--selected' : ''} ${agent.id === currentAgent ? 'sparo-chat-input__slash-command-item--active' : ''}`}
              description={<span className="sparo-chat-input__slash-command-label">{agent.name}</span>}
              meta={agent.id === currentAgent ? <Badge className="sparo-chat-input__slash-command-current" variant="accent">{labels.current}</Badge> : undefined}
              onClick={() => onSelectAgent(agent.id)}
              onMouseEnter={() => onHoverIndex(index)}
              selected={index === state.selectedIndex}
              title={<span className="sparo-chat-input__slash-command-name">/{agent.id}</span>}
            />
          ))
        ) : (
          <div className="sparo-chat-input__slash-command-empty">
            {labels.noMatchingAgent}
          </div>
        )}
      </div>
    </div>
  );
}
