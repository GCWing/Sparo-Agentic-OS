import type React from 'react';
import { BookOpen, ChevronRight, Files, Image, MessageSquarePlus, Plus, Sparkles, X } from 'lucide-react';
import { Badge, Button, IconButton, SelectableRow, Spinner, Tooltip } from '@/design-system';
import { useMovingHoverHighlight } from '@/shared/hooks/useMovingHoverHighlight';
import type { SkillInfo } from '@/infrastructure/config/types';
import type { AgentInfo } from '../../reducers/agentReducer';

interface ComposerBoostMenuProps {
  hostRef: React.Ref<HTMLDivElement>;
  skillsHostRef: React.Ref<HTMLDivElement>;
  canSwitchAgents: boolean;
  currentAgent: string;
  availableAgents: AgentInfo[];
  incrementalAgents: AgentInfo[];
  dropdownOpen: boolean;
  skillsFlyoutOpen: boolean;
  skillsFlyoutLeft: boolean;
  skillsFlyoutUp: boolean;
  skillsTooltipSuppressed: boolean;
  boostPanelSkills: SkillInfo[];
  boostSkillsLoading: boolean;
  currentSessionId?: string;
  isBtwSession: boolean;
  labels: {
    addBoostTooltip: string;
    resetToAgentic: string;
    current: string;
    noIncrementalAgents: string;
    boostAddContext: string;
    addImage: string;
    boostSkills: string;
    boostSkillsLoading: string;
    boostSkillsEmpty: string;
    openSkillsLibrary: string;
    boostStartBtw: string;
  };
  getAgentName: (mode: AgentInfo | string) => string;
  getAgentDescription: (mode: AgentInfo) => string;
  onToggleDropdown: (event: React.MouseEvent) => void;
  onCloseDropdown: () => void;
  onResetAgent: (event: React.MouseEvent) => void;
  onRequestAgentChange: (agentId: string, event: React.MouseEvent) => void;
  onOpenContext: (event: React.MouseEvent) => void;
  onPickImage: (event: React.MouseEvent) => void;
  onOpenSkillsFlyout: () => void;
  onCloseSkillsFlyout: () => void;
  onSkillsListScroll: () => void;
  onInsertSkill: (skillName: string, event: React.MouseEvent) => void;
  onOpenSkillsLibrary: (event: React.MouseEvent) => void;
  onStartBtw: (event: React.MouseEvent) => void;
}

export function ComposerBoostMenu({
  hostRef,
  skillsHostRef,
  canSwitchAgents,
  currentAgent,
  availableAgents,
  incrementalAgents,
  dropdownOpen,
  skillsFlyoutOpen,
  skillsFlyoutLeft,
  skillsFlyoutUp,
  skillsTooltipSuppressed,
  boostPanelSkills,
  boostSkillsLoading,
  currentSessionId,
  isBtwSession,
  labels,
  getAgentName,
  getAgentDescription,
  onToggleDropdown,
  onResetAgent,
  onRequestAgentChange,
  onOpenContext,
  onPickImage,
  onOpenSkillsFlyout,
  onCloseSkillsFlyout,
  onSkillsListScroll,
  onInsertSkill,
  onOpenSkillsLibrary,
  onStartBtw,
}: ComposerBoostMenuProps) {
  const agentSectionHover = useMovingHoverHighlight<HTMLDivElement>();
  const contextSectionHover = useMovingHoverHighlight<HTMLDivElement>();
  const skillsPanelHover = useMovingHoverHighlight<HTMLDivElement>();

  return (
    <div className="sparo-chat-input__agent-boost" ref={hostRef}>
      <Tooltip content={labels.addBoostTooltip}>
        <IconButton
          aria-label={labels.addBoostTooltip}
          className="sparo-chat-input__agent-boost-add"
          variant="ghost"
          size="xs"
          aria-haspopup="menu"
          aria-expanded={dropdownOpen}
          onClick={onToggleDropdown}
        >
          <Plus size={14} strokeWidth={2.25} />
        </IconButton>
      </Tooltip>

      {canSwitchAgents && currentAgent !== 'agentic' && (
        <div
          className={`sparo-chat-input__agent-capsule sparo-chat-input__agent-capsule--${currentAgent === 'debug' ? 'debug' : currentAgent}`}
        >
          <span className="sparo-chat-input__agent-capsule-label">
            {getAgentName(currentAgent) ||
              availableAgents.find(m => m.id === currentAgent)?.name ||
              currentAgent}
          </span>
          <IconButton
            aria-label={labels.resetToAgentic}
            className="sparo-chat-input__agent-capsule-close"
            onClick={onResetAgent}
            size="xs"
          >
            <X size={12} strokeWidth={2.5} />
          </IconButton>
        </div>
      )}

      {dropdownOpen && (
        <div className="sparo-chat-input__mode-dropdown sparo-chat-input__mode-dropdown--agent-boost">
          {canSwitchAgents && (
            <>
              <div
                ref={agentSectionHover.surfaceRef}
                className="sparo-chat-input__boost-section sparo-chat-input__boost-section--motion sparo-chat-input__boost-section--agent-motion"
                {...agentSectionHover.getSurfaceHandlers('.sparo-chat-input__mode-option')}
              >
                <div
                  className={`sparo-chat-input__boost-motion-highlight ${agentSectionHover.highlight.visible ? 'sparo-chat-input__boost-motion-highlight--visible' : ''}`}
                  style={{
                    '--sparo-boost-hover-top': `${agentSectionHover.highlight.top}px`,
                    '--sparo-boost-hover-left': `${agentSectionHover.highlight.left}px`,
                    '--sparo-boost-hover-width': `${agentSectionHover.highlight.width}px`,
                    '--sparo-boost-hover-height': `${agentSectionHover.highlight.height}px`,
                    '--sparo-boost-hover-stretch-x': agentSectionHover.highlight.stretchX,
                    '--sparo-boost-hover-stretch-y': agentSectionHover.highlight.stretchY,
                  } as React.CSSProperties}
                  aria-hidden
                />
                {incrementalAgents.length > 0 ? (
                  incrementalAgents.map(agentOption => {
                    const agentDescription = getAgentDescription(agentOption);
                    const agentName = getAgentName(agentOption);
                    return (
                      <Tooltip key={agentOption.id} content={agentDescription} placement="left">
                        <SelectableRow
                          className={`sparo-chat-input__mode-option ${currentAgent === agentOption.id ? 'sparo-chat-input__mode-option--active' : ''}`}
                          meta={currentAgent === agentOption.id ? <Badge className="sparo-chat-input__slash-command-current" variant="accent">{labels.current}</Badge> : undefined}
                          {...agentSectionHover.getItemHandlers()}
                          onClick={e => onRequestAgentChange(agentOption.id, e)}
                          selected={currentAgent === agentOption.id}
                          title={<span className="sparo-chat-input__mode-option-name">{agentName}</span>}
                        />
                      </Tooltip>
                    );
                  })
                ) : (
                  <div className="sparo-chat-input__agent-boost-empty sparo-chat-input__agent-boost-empty--inline">
                    {labels.noIncrementalAgents}
                  </div>
                )}
              </div>

              <div className="sparo-chat-input__boost-section-divider" aria-hidden />
            </>
          )}

          <div
            ref={contextSectionHover.surfaceRef}
            className={[
              'sparo-chat-input__boost-section',
              'sparo-chat-input__boost-section--motion',
              'sparo-chat-input__boost-section--context-motion',
              skillsFlyoutOpen ? 'sparo-chat-input__boost-section--skills-open' : '',
            ].filter(Boolean).join(' ')}
            {...contextSectionHover.getSurfaceHandlers('.sparo-chat-input__boost-context-row, .sparo-chat-input__boost-submenu-trigger')}
          >
            <div
              className={`sparo-chat-input__boost-motion-highlight ${contextSectionHover.highlight.visible ? 'sparo-chat-input__boost-motion-highlight--visible' : ''}`}
              style={{
                '--sparo-boost-hover-top': `${contextSectionHover.highlight.top}px`,
                '--sparo-boost-hover-left': `${contextSectionHover.highlight.left}px`,
                '--sparo-boost-hover-width': `${contextSectionHover.highlight.width}px`,
                '--sparo-boost-hover-height': `${contextSectionHover.highlight.height}px`,
                '--sparo-boost-hover-stretch-x': contextSectionHover.highlight.stretchX,
                '--sparo-boost-hover-stretch-y': contextSectionHover.highlight.stretchY,
              } as React.CSSProperties}
              aria-hidden
            />
            <Button
              className="sparo-chat-input__boost-context-row"
              {...contextSectionHover.getItemHandlers()}
              onClick={onOpenContext}
              size="small"
              variant="ghost"
            >
              <Files size={14} className="sparo-chat-input__boost-context-icon" aria-hidden />
              <span>{labels.boostAddContext}</span>
            </Button>

            <Button
              className="sparo-chat-input__boost-context-row"
              {...contextSectionHover.getItemHandlers()}
              onClick={onPickImage}
              size="small"
              variant="ghost"
            >
              <Image size={14} className="sparo-chat-input__boost-context-icon" aria-hidden />
              <span>{labels.addImage}</span>
            </Button>

            <div
              ref={skillsHostRef}
              className="sparo-chat-input__boost-submenu-host"
              onMouseEnter={onOpenSkillsFlyout}
              onMouseLeave={onCloseSkillsFlyout}
            >
              <Button
                className="sparo-chat-input__boost-submenu-trigger"
                aria-haspopup="menu"
                aria-expanded={skillsFlyoutOpen}
                {...contextSectionHover.getItemHandlers()}
                size="small"
                variant="ghost"
              >
                <span className="sparo-chat-input__boost-submenu-trigger-main">
                  <Sparkles size={14} className="sparo-chat-input__boost-context-icon" aria-hidden />
                  <span>{labels.boostSkills}</span>
                </span>
                <ChevronRight size={14} className="sparo-chat-input__boost-submenu-chevron" aria-hidden />
              </Button>
              <div
                className={[
                  'sparo-chat-input__boost-submenu-shell',
                  skillsFlyoutOpen ? 'sparo-chat-input__boost-submenu-shell--open' : '',
                  skillsFlyoutLeft ? 'sparo-chat-input__boost-submenu-shell--left' : '',
                  skillsFlyoutUp ? 'sparo-chat-input__boost-submenu-shell--up' : '',
                ].filter(Boolean).join(' ')}
                onMouseEnter={() => {
                  contextSectionHover.hideHighlight();
                  onOpenSkillsFlyout();
                }}
                onMouseLeave={onCloseSkillsFlyout}
              >
                <div
                  ref={skillsPanelHover.surfaceRef}
                  className="sparo-chat-input__boost-submenu-panel sparo-chat-input__boost-submenu-panel--motion"
                  {...skillsPanelHover.getSurfaceHandlers('.sparo-chat-input__boost-submenu-entry, .sparo-chat-input__boost-submenu-manage')}
                >
                  <div
                    className={`sparo-chat-input__boost-motion-highlight ${skillsPanelHover.highlight.visible ? 'sparo-chat-input__boost-motion-highlight--visible' : ''}`}
                    style={{
                      '--sparo-boost-hover-top': `${skillsPanelHover.highlight.top}px`,
                      '--sparo-boost-hover-left': `${skillsPanelHover.highlight.left}px`,
                      '--sparo-boost-hover-width': `${skillsPanelHover.highlight.width}px`,
                      '--sparo-boost-hover-height': `${skillsPanelHover.highlight.height}px`,
                      '--sparo-boost-hover-stretch-x': skillsPanelHover.highlight.stretchX,
                      '--sparo-boost-hover-stretch-y': skillsPanelHover.highlight.stretchY,
                    } as React.CSSProperties}
                    aria-hidden
                  />
                  {boostSkillsLoading ? (
                    <div className="sparo-chat-input__boost-submenu-loading">
                      <Spinner
                        className="sparo-chat-input__boost-submenu-spinner"
                        label={labels.boostSkillsLoading}
                        size="small"
                      />
                    </div>
                  ) : boostPanelSkills.length === 0 ? (
                    <div className="sparo-chat-input__boost-submenu-empty">{labels.boostSkillsEmpty}</div>
                  ) : (
                    <div className="sparo-chat-input__boost-submenu-list" onScroll={onSkillsListScroll}>
                      {boostPanelSkills.map(skill => (
                        <Tooltip
                          key={skill.name}
                          content={skill.description || skill.name}
                          disabled={skillsTooltipSuppressed}
                          placement="left"
                        >
                          <Button
                            className="sparo-chat-input__boost-submenu-entry"
                            {...skillsPanelHover.getItemHandlers()}
                            onClick={e => onInsertSkill(skill.name, e)}
                            size="small"
                            variant="ghost"
                          >
                            <BookOpen size={14} className="sparo-chat-input__boost-context-icon" aria-hidden />
                            <span className="sparo-chat-input__boost-submenu-entry-name">{skill.name}</span>
                          </Button>
                        </Tooltip>
                      ))}
                    </div>
                  )}
                  <Button
                    className="sparo-chat-input__boost-submenu-manage"
                    {...skillsPanelHover.getItemHandlers()}
                    onClick={onOpenSkillsLibrary}
                    size="small"
                    variant="ghost"
                  >
                    {labels.openSkillsLibrary}
                  </Button>
                </div>
              </div>
            </div>

            {!!currentSessionId && !isBtwSession && (
              <>
                <div className="sparo-chat-input__boost-section-divider" aria-hidden />
                <Button
                  className="sparo-chat-input__boost-context-row"
                  data-testid="chat-input-boost-start-btw"
                  {...contextSectionHover.getItemHandlers()}
                  onClick={onStartBtw}
                  size="small"
                  variant="ghost"
                >
                  <MessageSquarePlus size={14} className="sparo-chat-input__boost-context-icon" aria-hidden />
                  <span>{labels.boostStartBtw}</span>
                </Button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
