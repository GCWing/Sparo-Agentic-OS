import type React from 'react';
import { BookOpen, ChevronRight, Files, Image, MessageSquarePlus, Plus, Sparkles, X } from 'lucide-react';
import { Badge, Button, IconButton, SelectableRow, Spinner, Tooltip } from '@/design-system';
import type { SkillInfo } from '@/infrastructure/config/types';
import type { ModeInfo } from '../../reducers/modeReducer';

interface ComposerBoostMenuProps {
  hostRef: React.Ref<HTMLDivElement>;
  skillsHostRef: React.Ref<HTMLDivElement>;
  canSwitchModes: boolean;
  currentMode: string;
  availableModes: ModeInfo[];
  incrementalModes: ModeInfo[];
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
    noIncrementalModes: string;
    boostAddContext: string;
    addImage: string;
    boostSkills: string;
    boostSkillsLoading: string;
    boostSkillsEmpty: string;
    openSkillsLibrary: string;
    boostStartBtw: string;
  };
  getModeName: (mode: ModeInfo | string) => string;
  getModeDescription: (mode: ModeInfo) => string;
  onToggleDropdown: (event: React.MouseEvent) => void;
  onCloseDropdown: () => void;
  onResetMode: (event: React.MouseEvent) => void;
  onRequestModeChange: (modeId: string, event: React.MouseEvent) => void;
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
  canSwitchModes,
  currentMode,
  availableModes,
  incrementalModes,
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
  getModeName,
  getModeDescription,
  onToggleDropdown,
  onResetMode,
  onRequestModeChange,
  onOpenContext,
  onPickImage,
  onOpenSkillsFlyout,
  onCloseSkillsFlyout,
  onSkillsListScroll,
  onInsertSkill,
  onOpenSkillsLibrary,
  onStartBtw,
}: ComposerBoostMenuProps) {
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

      {canSwitchModes && currentMode !== 'agentic' && (
        <div
          className={`sparo-chat-input__agent-capsule sparo-chat-input__agent-capsule--${currentMode === 'debug' ? 'debug' : currentMode}`}
        >
          <span className="sparo-chat-input__agent-capsule-label">
            {getModeName(currentMode) ||
              availableModes.find(m => m.id === currentMode)?.name ||
              currentMode}
          </span>
          <IconButton
            aria-label={labels.resetToAgentic}
            className="sparo-chat-input__agent-capsule-close"
            onClick={onResetMode}
            size="xs"
          >
            <X size={12} strokeWidth={2.5} />
          </IconButton>
        </div>
      )}

      {dropdownOpen && (
        <div className="sparo-chat-input__mode-dropdown sparo-chat-input__mode-dropdown--agent-boost">
          {canSwitchModes && (
            <>
              <div className="sparo-chat-input__boost-section">
                {incrementalModes.length > 0 ? (
                  incrementalModes.map(modeOption => {
                    const modeDescription = getModeDescription(modeOption);
                    const modeName = getModeName(modeOption);
                    return (
                      <Tooltip key={modeOption.id} content={modeDescription} placement="left">
                        <SelectableRow
                          className={`sparo-chat-input__mode-option ${currentMode === modeOption.id ? 'sparo-chat-input__mode-option--active' : ''}`}
                          meta={currentMode === modeOption.id ? <Badge className="sparo-chat-input__slash-command-current" variant="accent">{labels.current}</Badge> : undefined}
                          onClick={e => onRequestModeChange(modeOption.id, e)}
                          selected={currentMode === modeOption.id}
                          title={<span className="sparo-chat-input__mode-option-name">{modeName}</span>}
                        />
                      </Tooltip>
                    );
                  })
                ) : (
                  <div className="sparo-chat-input__agent-boost-empty sparo-chat-input__agent-boost-empty--inline">
                    {labels.noIncrementalModes}
                  </div>
                )}
              </div>

              <div className="sparo-chat-input__boost-section-divider" aria-hidden />
            </>
          )}

          <div className="sparo-chat-input__boost-section">
            <Button
              className="sparo-chat-input__boost-context-row"
              onClick={onOpenContext}
              size="small"
              variant="ghost"
            >
              <Files size={14} className="sparo-chat-input__boost-context-icon" aria-hidden />
              <span>{labels.boostAddContext}</span>
            </Button>

            <Button
              className="sparo-chat-input__boost-context-row"
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
                onMouseEnter={onOpenSkillsFlyout}
                onMouseLeave={onCloseSkillsFlyout}
              >
                <div className="sparo-chat-input__boost-submenu-panel">
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
