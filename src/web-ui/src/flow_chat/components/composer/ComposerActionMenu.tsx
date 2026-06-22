import React from 'react';
import {
  Bot,
  BookOpen,
  ChevronRight,
  CircuitBoard,
  FileCog,
  Files,
  Flag,
  Image,
  MessageSquarePlus,
  Minimize2,
  Sparkles,
} from 'lucide-react';
import { Badge, Button, SelectableRow, Spinner, Tooltip } from '@/design-system';
import { useMovingHoverHighlight } from '@/shared/hooks/useMovingHoverHighlight';
import type { SkillInfo } from '@/infrastructure/config/types';
import type {
  ComposerActionDescriptor,
  ComposerActionIconId,
  ComposerActionSection,
} from './actions/composerActionTypes';
import { ComposerActionAnchor } from './ComposerActionAnchor';

interface ComposerActionMenuProps {
  hostRef: React.Ref<HTMLDivElement>;
  skillsHostRef: React.Ref<HTMLDivElement>;
  sections: ComposerActionSection[];
  dropdownOpen: boolean;
  skillsFlyoutOpen: boolean;
  skillsFlyoutLeft: boolean;
  skillsFlyoutUp: boolean;
  skillsTooltipSuppressed: boolean;
  boostPanelSkills: SkillInfo[];
  boostSkillsLoading: boolean;
  selectedAgentLabel?: string | null;
  labels: {
    addBoostTooltip: string;
    current: string;
    resetAgent: string;
    switchAgent: string;
    boostSkillsLoading: string;
    boostSkillsEmpty: string;
    openSkillsLibrary: string;
  };
  onToggleDropdown: (event: React.MouseEvent) => void;
  onResetAgent: (event: React.MouseEvent) => void;
  onSelectAction: (action: ComposerActionDescriptor, event: React.MouseEvent) => void;
  onOpenSkillsFlyout: () => void;
  onCloseSkillsFlyout: () => void;
  onSkillsListScroll: () => void;
  onInsertSkill: (skillName: string, event: React.MouseEvent) => void;
  onOpenSkillsLibrary: (event: React.MouseEvent) => void;
}

function renderActionIcon(icon: ComposerActionIconId): React.ReactNode {
  const common = { size: 14, className: 'sparo-chat-input__boost-context-icon', 'aria-hidden': true };
  switch (icon) {
    case 'agent':
      return <Bot {...common} />;
    case 'context':
      return <Files {...common} />;
    case 'image':
      return <Image {...common} />;
    case 'skills':
      return <Sparkles {...common} />;
    case 'btw':
      return <MessageSquarePlus {...common} />;
    case 'goal':
      return <Flag {...common} />;
    case 'compact':
      return <Minimize2 {...common} />;
    case 'init':
      return <FileCog {...common} />;
    case 'prompt':
      return <BookOpen {...common} />;
    case 'app':
    default:
      return <CircuitBoard {...common} />;
  }
}

function actionTooltip(action: ComposerActionDescriptor): string {
  return action.availability.reason || action.description;
}

export function ComposerActionMenu({
  hostRef,
  skillsHostRef,
  sections,
  dropdownOpen,
  skillsFlyoutOpen,
  skillsFlyoutLeft,
  skillsFlyoutUp,
  skillsTooltipSuppressed,
  boostPanelSkills,
  boostSkillsLoading,
  selectedAgentLabel,
  labels,
  onToggleDropdown,
  onResetAgent,
  onSelectAction,
  onOpenSkillsFlyout,
  onCloseSkillsFlyout,
  onSkillsListScroll,
  onInsertSkill,
  onOpenSkillsLibrary,
}: ComposerActionMenuProps) {
  const agentSectionHover = useMovingHoverHighlight<HTMLDivElement>();
  const contextSectionHover = useMovingHoverHighlight<HTMLDivElement>();
  const intentSectionHover = useMovingHoverHighlight<HTMLDivElement>();
  const appSectionHover = useMovingHoverHighlight<HTMLDivElement>();
  const skillsPanelHover = useMovingHoverHighlight<HTMLDivElement>();

  const sectionHover = {
    agent: agentSectionHover,
    context: contextSectionHover,
    intent: intentSectionHover,
    app: appSectionHover,
  };

  const renderSectionHighlight = (
    hover: ReturnType<typeof useMovingHoverHighlight<HTMLDivElement>>,
    prefix: ComposerActionSection['id'],
  ) => (
    <div
      className={`sparo-chat-input__boost-motion-highlight ${hover.highlight.visible ? 'sparo-chat-input__boost-motion-highlight--visible' : ''}`}
      style={{
        '--sparo-boost-hover-top': `${hover.highlight.top}px`,
        '--sparo-boost-hover-left': `${hover.highlight.left}px`,
        '--sparo-boost-hover-width': `${hover.highlight.width}px`,
        '--sparo-boost-hover-height': `${hover.highlight.height}px`,
        '--sparo-boost-hover-stretch-x': hover.highlight.stretchX,
        '--sparo-boost-hover-stretch-y': hover.highlight.stretchY,
      } as React.CSSProperties}
      data-section={prefix}
      aria-hidden
    />
  );

  const renderAgentAction = (
    action: ComposerActionDescriptor,
    hover: ReturnType<typeof useMovingHoverHighlight<HTMLDivElement>>,
  ) => {
    const disabled = action.availability.state !== 'enabled';
    return (
      <Tooltip key={action.id} content={actionTooltip(action)} placement="left">
        <SelectableRow
          className={`sparo-chat-input__mode-option ${action.current ? 'sparo-chat-input__mode-option--active' : ''}`}
          data-testid={`composer-action-${action.id}`}
          disabled={disabled}
          meta={action.current ? (
            <Badge className="sparo-chat-input__slash-command-current" variant="accent">
              {labels.current}
            </Badge>
          ) : undefined}
          {...hover.getItemHandlers()}
          onClick={disabled ? undefined : e => onSelectAction(action, e)}
          selected={Boolean(action.current)}
          title={<span className="sparo-chat-input__mode-option-name">{action.label}</span>}
        />
      </Tooltip>
    );
  };

  const renderSkillsAction = (
    action: ComposerActionDescriptor,
    hover: ReturnType<typeof useMovingHoverHighlight<HTMLDivElement>>,
  ) => {
    const disabled = action.availability.state !== 'enabled';
    return (
      <div
        key={action.id}
        ref={skillsHostRef}
        className="sparo-chat-input__boost-submenu-host"
        onMouseEnter={disabled ? undefined : onOpenSkillsFlyout}
        onMouseLeave={onCloseSkillsFlyout}
      >
        <Tooltip content={actionTooltip(action)} placement="left">
          <Button
            className="sparo-chat-input__boost-submenu-trigger"
            aria-haspopup="menu"
            aria-expanded={skillsFlyoutOpen}
            disabled={disabled}
            {...hover.getItemHandlers()}
            onClick={event => {
              event.stopPropagation();
              if (!disabled) onOpenSkillsFlyout();
            }}
            size="small"
            variant="ghost"
          >
            <span className="sparo-chat-input__boost-submenu-trigger-main">
              {renderActionIcon(action.icon)}
              <span>{action.label}</span>
            </span>
            <ChevronRight size={14} className="sparo-chat-input__boost-submenu-chevron" aria-hidden />
          </Button>
        </Tooltip>
        <div
          className={[
            'sparo-chat-input__boost-submenu-shell',
            skillsFlyoutOpen ? 'sparo-chat-input__boost-submenu-shell--open' : '',
            skillsFlyoutLeft ? 'sparo-chat-input__boost-submenu-shell--left' : '',
            skillsFlyoutUp ? 'sparo-chat-input__boost-submenu-shell--up' : '',
          ].filter(Boolean).join(' ')}
          onMouseEnter={() => {
            hover.hideHighlight();
            onOpenSkillsFlyout();
          }}
          onMouseLeave={onCloseSkillsFlyout}
        >
          <div
            ref={skillsPanelHover.surfaceRef}
            className="sparo-chat-input__boost-submenu-panel sparo-chat-input__boost-submenu-panel--motion"
            {...skillsPanelHover.getSurfaceHandlers('.sparo-chat-input__boost-submenu-entry')}
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
              onMouseEnter={skillsPanelHover.hideHighlight}
              onPointerEnter={skillsPanelHover.hideHighlight}
              onClick={onOpenSkillsLibrary}
              size="small"
              variant="ghost"
            >
              {labels.openSkillsLibrary}
            </Button>
          </div>
        </div>
      </div>
    );
  };

  const renderRowAction = (
    action: ComposerActionDescriptor,
    hover: ReturnType<typeof useMovingHoverHighlight<HTMLDivElement>>,
  ) => {
    if (action.menu?.control === 'submenu' && action.select.type === 'open-skills-flyout') {
      return renderSkillsAction(action, hover);
    }

    const disabled = action.availability.state !== 'enabled';
    return (
      <Tooltip key={action.id} content={actionTooltip(action)} placement="left">
        <Button
          className="sparo-chat-input__boost-context-row"
          data-testid={action.menu?.testId ?? `composer-action-${action.id}`}
          disabled={disabled}
          {...hover.getItemHandlers()}
          onClick={disabled ? undefined : event => onSelectAction(action, event)}
          size="small"
          variant="ghost"
        >
          {renderActionIcon(action.icon)}
          <span>{action.label}</span>
        </Button>
      </Tooltip>
    );
  };

  const renderActionSection = (section: ComposerActionSection) => {
    const hover = sectionHover[section.id];
    const itemSelector = section.id === 'agent'
      ? '.sparo-chat-input__mode-option'
      : '.sparo-chat-input__boost-context-row, .sparo-chat-input__boost-submenu-trigger';

    return (
      <div
        key={section.id}
        ref={hover.surfaceRef}
        className={[
          'sparo-chat-input__boost-section',
          'sparo-chat-input__boost-section--motion',
          section.id === 'agent' ? 'sparo-chat-input__boost-section--agent-motion' : '',
          section.id !== 'agent' ? 'sparo-chat-input__boost-section--context-motion' : '',
          skillsFlyoutOpen && section.id === 'context' ? 'sparo-chat-input__boost-section--skills-open' : '',
        ].filter(Boolean).join(' ')}
        {...hover.getSurfaceHandlers(itemSelector)}
      >
        {renderSectionHighlight(hover, section.id)}
        {section.actions.map(action => (
          section.id === 'agent'
            ? renderAgentAction(action, hover)
            : renderRowAction(action, hover)
        ))}
      </div>
    );
  };

  return (
    <div
      className={[
        'sparo-chat-input__agent-boost',
        dropdownOpen ? 'sparo-chat-input__agent-boost--open' : '',
      ].filter(Boolean).join(' ')}
      ref={hostRef}
    >
      <ComposerActionAnchor
        dropdownOpen={dropdownOpen}
        selectedAgentLabel={selectedAgentLabel}
        labels={{
          addBoostTooltip: labels.addBoostTooltip,
          resetAgent: labels.resetAgent,
          switchAgent: labels.switchAgent,
        }}
        onToggleDropdown={onToggleDropdown}
        onResetAgent={onResetAgent}
      />

      {dropdownOpen && (
        <div className="sparo-chat-input__mode-dropdown sparo-chat-input__mode-dropdown--agent-boost">
          {sections.map((section, index) => (
            <React.Fragment key={section.id}>
              {index > 0 && <div className="sparo-chat-input__boost-section-divider" aria-hidden />}
              {renderActionSection(section)}
            </React.Fragment>
          ))}
        </div>
      )}
    </div>
  );
}
