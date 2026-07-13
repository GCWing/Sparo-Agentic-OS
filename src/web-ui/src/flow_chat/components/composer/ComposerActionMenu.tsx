import React from 'react';
import {
  Bot,
  BookOpen,
  Check,
  ChevronDown,
  ChevronRight,
  CircuitBoard,
  FileCog,
  Files,
  Flag,
  Image,
  Layers,
  MessageSquarePlus,
  Minimize2,
  Sparkles,
} from 'lucide-react';
import {
  Badge,
  Button,
  PopupMenu,
  Search,
  SelectableRow,
  Spinner,
  Tooltip,
} from '@/design-system';
import { useMovingHoverHighlight } from '@/shared/hooks/useMovingHoverHighlight';
import {
  filterSkillLibraryUnits,
  selectionTargetFromSkill,
  selectionTargetFromUnit,
  type SkillLibraryUnit,
  type SkillSelectionTarget,
} from '@/shared/skillLibrary';
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
  skillUnits: SkillLibraryUnit[];
  selectedSkillCommands: Set<string>;
  boostSkillsLoading: boolean;
  selectedAgentLabel?: string | null;
  labels: {
    addBoostTooltip: string;
    current: string;
    resetAgent: string;
    switchAgent: string;
    boostSkillsLoading: string;
    boostSkillsEmpty: string;
    boostSkillsNoMatch: string;
    boostSkillsSearch: string;
    boostSkillsSuites: string;
    boostSkillsStandalone: string;
    expandSuite: string;
    collapseSuite: string;
    selected: string;
    openSkillsLibrary: string;
  };
  onToggleDropdown: (event: React.MouseEvent) => void;
  onResetAgent: (event: React.MouseEvent) => void;
  onSelectAction: (action: ComposerActionDescriptor, event: React.MouseEvent) => void;
  onOpenSkillsFlyout: () => void;
  onCloseSkillsFlyout: () => void;
  onSkillsListScroll: () => void;
  onInsertSkill: (target: SkillSelectionTarget, event: React.MouseEvent) => void;
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
  skillUnits,
  selectedSkillCommands,
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
  const [skillSearch, setSkillSearch] = React.useState('');
  const [expandedSuites, setExpandedSuites] = React.useState<Set<string>>(new Set());
  const filteredSkillUnits = React.useMemo(
    () => filterSkillLibraryUnits(skillUnits, { query: skillSearch }),
    [skillSearch, skillUnits],
  );
  const suiteUnits = filteredSkillUnits.filter(unit => unit.kind === 'suite');
  const standaloneUnits = filteredSkillUnits.filter(unit => unit.kind === 'skill');

  React.useEffect(() => {
    if (!skillsFlyoutOpen) {
      setSkillSearch('');
      setExpandedSuites(new Set());
    }
  }, [skillsFlyoutOpen]);

  const toggleSuite = React.useCallback((suiteKey: string) => {
    setExpandedSuites(current => {
      const next = new Set(current);
      if (next.has(suiteKey)) next.delete(suiteKey);
      else next.add(suiteKey);
      return next;
    });
  }, []);

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
          <PopupMenu padding="none" className="sparo-chat-input__boost-submenu-panel">
            <div className="sparo-chat-input__boost-submenu-search">
              <Search
                value={skillSearch}
                onChange={setSkillSearch}
                onClear={() => setSkillSearch('')}
                placeholder={labels.boostSkillsSearch}
                size="small"
                clearable
              />
            </div>
            {boostSkillsLoading ? (
              <div className="sparo-chat-input__boost-submenu-loading">
                <Spinner
                  className="sparo-chat-input__boost-submenu-spinner"
                  label={labels.boostSkillsLoading}
                  size="small"
                />
              </div>
            ) : skillUnits.length === 0 ? (
              <div className="sparo-chat-input__boost-submenu-empty">{labels.boostSkillsEmpty}</div>
            ) : filteredSkillUnits.length === 0 ? (
              <div className="sparo-chat-input__boost-submenu-empty">{labels.boostSkillsNoMatch}</div>
            ) : (
              <div className="sparo-chat-input__boost-submenu-list" onScroll={onSkillsListScroll}>
                {suiteUnits.length > 0 ? (
                  <div className="sparo-chat-input__boost-submenu-group-label">{labels.boostSkillsSuites}</div>
                ) : null}
                {suiteUnits.map(unit => {
                  if (unit.kind !== 'suite') return null;
                  const target = selectionTargetFromUnit(unit);
                  const selected = selectedSkillCommands.has(target.command);
                  const normalizedSearch = skillSearch.trim().toLocaleLowerCase();
                  const matchingMembers = normalizedSearch
                    ? unit.members.filter(member => [member.name, member.description]
                        .some(value => value.toLocaleLowerCase().includes(normalizedSearch)))
                    : unit.members;
                  const expanded = expandedSuites.has(unit.key) || (normalizedSearch.length > 0 && matchingMembers.length > 0);
                  return (
                    <div key={unit.key} className="sparo-chat-input__boost-submenu-suite">
                      <div className="sparo-chat-input__boost-submenu-suite-row">
                        <Tooltip
                          content={unit.description || unit.name}
                          disabled={skillsTooltipSuppressed}
                          placement="left"
                        >
                          <Button
                            className="sparo-chat-input__boost-submenu-suite-select"
                            onClick={event => onInsertSkill(target, event)}
                            size="small"
                            variant="ghost"
                          >
                            <Layers size={15} className="sparo-chat-input__boost-context-icon" aria-hidden />
                            <span className="sparo-chat-input__boost-submenu-entry-name">{unit.name}</span>
                            {selected ? <Check size={14} aria-label={labels.selected} /> : null}
                          </Button>
                        </Tooltip>
                        <Button
                          className="sparo-chat-input__boost-submenu-suite-toggle"
                          variant="ghost"
                          size="small"
                          shape="pill"
                          aria-label={expanded ? labels.collapseSuite : labels.expandSuite}
                          aria-expanded={expanded}
                          onClick={event => {
                            event.stopPropagation();
                            toggleSuite(unit.key);
                          }}
                        >
                          <span className="sparo-chat-input__boost-submenu-entry-count">
                            {unit.members.length}
                          </span>
                          {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                        </Button>
                      </div>
                      {expanded ? (
                        <div className="sparo-chat-input__boost-submenu-members">
                          {matchingMembers.map(member => {
                            const memberTarget = selectionTargetFromSkill(member, unit.suite);
                            const memberSelected = selectedSkillCommands.has(memberTarget.command);
                            const includedBySuite = selected && !memberSelected;
                            return (
                              <Tooltip
                                key={member.key}
                                content={member.description || member.name}
                                disabled={skillsTooltipSuppressed}
                                placement="left"
                              >
                                <Button
                                  className="sparo-chat-input__boost-submenu-entry sparo-chat-input__boost-submenu-entry--member"
                                  onClick={event => onInsertSkill(memberTarget, event)}
                                  size="small"
                                  variant="ghost"
                                >
                                  <BookOpen size={14} className="sparo-chat-input__boost-context-icon" aria-hidden />
                                  <span className="sparo-chat-input__boost-submenu-entry-name">{member.name}</span>
                                  {memberSelected || includedBySuite ? <Check size={13} aria-label={labels.selected} /> : null}
                                </Button>
                              </Tooltip>
                            );
                          })}
                        </div>
                      ) : null}
                    </div>
                  );
                })}
                {standaloneUnits.length > 0 ? (
                  <div className="sparo-chat-input__boost-submenu-group-label">{labels.boostSkillsStandalone}</div>
                ) : null}
                {standaloneUnits.map(unit => {
                  if (unit.kind !== 'skill') return null;
                  const target = selectionTargetFromUnit(unit);
                  const selected = selectedSkillCommands.has(target.command);
                  return (
                    <Tooltip
                      key={unit.key}
                      content={unit.description || unit.name}
                      disabled={skillsTooltipSuppressed}
                      placement="left"
                    >
                      <Button
                        className="sparo-chat-input__boost-submenu-entry"
                        onClick={event => onInsertSkill(target, event)}
                        size="small"
                        variant="ghost"
                      >
                        <BookOpen size={14} className="sparo-chat-input__boost-context-icon" aria-hidden />
                        <span className="sparo-chat-input__boost-submenu-entry-name">{unit.name}</span>
                        {selected ? <Check size={13} aria-label={labels.selected} /> : null}
                      </Button>
                    </Tooltip>
                  );
                })}
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
          </PopupMenu>
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
        <PopupMenu
          className="sparo-chat-input__mode-dropdown sparo-chat-input__mode-dropdown--agent-boost"
          padding="none"
        >
          {sections.map((section, index) => (
            <React.Fragment key={section.id}>
              {index > 0 && <div className="sparo-chat-input__boost-section-divider" aria-hidden />}
              {renderActionSection(section)}
            </React.Fragment>
          ))}
        </PopupMenu>
      )}
    </div>
  );
}
