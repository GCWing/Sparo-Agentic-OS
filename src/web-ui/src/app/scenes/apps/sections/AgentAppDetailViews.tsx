/**
 * Agent App in-scene detail views.
 * ModeAppDetailView — app overview detail (Coding App multi-agent catalog entries and standalone Agent apps).
 * AgentDetailView   — detail page for a single agent.
 */
import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  Bot,
  ChevronRight,
  Cpu,
  RefreshCw,
  Sparkles,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Badge, Button, Switch } from '@/design-system';
import { APP_ICON_MAP, CAPABILITY_ACCENT } from '../appVisuals';
import { getAgentBadge } from '../appsUtils';
import type { AgentWithCapabilities, AppCardModel } from '../hooks/useAppsData';
import type { ModeSkillInfo } from '@/infrastructure/config/types';

const SKILL_GROUP_ORDER: Record<string, number> = {
  office: 0,
  'computer-use': 1,
  meta: 2,
  team: 3,
  superpowers: 4,
};

function getSkillGroupLabel(key: string, t: (k: string) => string): string {
  switch (key) {
    case 'office': return t('agent.skillGroups.office');
    case 'computer-use': return t('agent.skillGroups.computerUse');
    case 'meta': return t('agent.skillGroups.meta');
    case 'team': return t('agent.skillGroups.team');
    case 'superpowers': return t('agent.skillGroups.superpowers');
    default: return t('agent.skillGroups.other');
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// ModeAppDetailView
// ─────────────────────────────────────────────────────────────────────────────

export const ModeAppDetailView: React.FC<{
  app: AppCardModel;
  onBack: () => void;
  onOpenAgent: (agentId: string) => void;
}> = ({ app, onBack, onOpenAgent }) => {
  const { t } = useTranslation('scenes/apps');
  const isStandalone = app.kind === 'standalone-agent-app';
  const HeroIcon = isStandalone ? Bot : Cpu;
  const displayName = app.dynamicName ?? t(app.nameKey);
  const displayDesc = app.dynamicDescription ?? t(app.descriptionKey);

  return (
    <div className="apps-detail">
      <div className="apps-detail__scroll">
        <div className="apps-detail__breadcrumb">
          <Button variant="ghost" size="small" className="apps-detail__back" onClick={onBack}>
            <ArrowLeft size={14} />
            <span>{t('page.sectionTitle')}</span>
          </Button>
          <ChevronRight size={12} className="apps-detail__crumb-sep" />
          <span className="apps-detail__crumb-current">{displayName}</span>
        </div>

        <header className="apps-detail__hero">
          <span className="apps-detail__icon"><HeroIcon size={28} strokeWidth={1.5} /></span>
          <div className="apps-detail__identity">
            <h1 className="apps-detail__title">{displayName}</h1>
            <p className="apps-detail__subtitle">{displayDesc}</p>
            <div className="apps-detail__badges">
              <Badge variant={isStandalone ? 'purple' : 'accent'}>{t(app.badgeKey)}</Badge>
              <Badge variant="neutral">
                {isStandalone
                  ? t('page.standaloneOneAgentBadge')
                  : t('page.containsAgents', { count: app.includedAgents.length })}
              </Badge>
            </div>
          </div>
        </header>

        <section className="apps-detail__section">
          <div className="apps-detail__section-head">
            <h3 className="apps-detail__section-title">{t('appDetail.includedAgentsTitle')}</h3>
            <span className="apps-detail__section-subtitle">
              {isStandalone ? t('appDetail.standaloneAgentsSubtitle') : t('appDetail.includedAgentsSubtitle')}
            </span>
          </div>
          <div className="apps-detail__list">
            {app.includedAgents.map((agent) => {
              const Icon = APP_ICON_MAP[(agent.iconKey ?? 'bot') as keyof typeof APP_ICON_MAP] ?? Bot;
              return (
                <Button
                  key={agent.id}
                  variant="ghost"
                  size="small"
                  className="apps-detail__row"
                  style={{ height: 'auto' }}
                  onClick={() => onOpenAgent(agent.id)}
                >
                  <span className="apps-detail__row-icon"><Icon size={18} /></span>
                  <span className="apps-detail__row-main">
                    <span className="apps-detail__row-title">{agent.name}</span>
                    <span className="apps-detail__row-desc">{agent.description || t('agent.noDescription')}</span>
                  </span>
                  <span className="apps-detail__row-meta">
                    <Badge variant="accent">{t('agent.badges.agent')}</Badge>
                    <ChevronRight size={14} />
                  </span>
                </Button>
              );
            })}
          </div>
        </section>
      </div>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// AgentDetailView
// ─────────────────────────────────────────────────────────────────────────────

interface ModeConfigLike { enabled_tools?: string[]; }

export const AgentDetailView: React.FC<{
  agent: AgentWithCapabilities;
  app: AppCardModel | null;
  availableTools: Array<{ name: string; description: string }>;
  getModeConfig: (id: string) => ModeConfigLike | null;
  getModeSkills: (id: string) => ModeSkillInfo[];
  onBack: () => void;
  handleSetTools: (id: string, tools: string[]) => Promise<void>;
  handleResetTools: (id: string) => Promise<void>;
  handleSetAgentEnabled: (id: string, enabled: boolean) => Promise<void>;
  handleSetSkills: (id: string, skills: string[]) => Promise<void>;
}> = ({ agent, app, availableTools, getModeConfig, getModeSkills, onBack, handleSetTools, handleResetTools, handleSetAgentEnabled, handleSetSkills }) => {
  const { t } = useTranslation('scenes/apps');
  const Icon = APP_ICON_MAP[(agent.iconKey ?? 'bot') as keyof typeof APP_ICON_MAP] ?? Bot;

  const config = getModeConfig(agent.id);
  const modeSkills = getModeSkills(agent.id);
  const activeTools = config?.enabled_tools ?? agent.defaultTools ?? [];
  const hasSkillTool = activeTools.includes('Skill');
  const activeSkillKeys = useMemo(
    () => modeSkills.filter((s) => !s.disabledByMode).map((s) => s.key),
    [modeSkills],
  );

  const [toolsEditing, setToolsEditing] = useState(false);
  const [pendingTools, setPendingTools] = useState<string[] | null>(null);
  const [savingTools, setSavingTools] = useState(false);
  const [skillsEditing, setSkillsEditing] = useState(false);
  const [pendingSkills, setPendingSkills] = useState<string[] | null>(null);
  const [savingSkills, setSavingSkills] = useState(false);
  const [savingEnabled, setSavingEnabled] = useState(false);

  useEffect(() => {
    setToolsEditing(false);
    setSkillsEditing(false);
    setPendingTools(null);
    setPendingSkills(null);
  }, [agent.id]);

  const visibleTools = toolsEditing ? (pendingTools ?? activeTools) : activeTools;
  const visibleSkills = skillsEditing ? (pendingSkills ?? activeSkillKeys) : activeSkillKeys;

  const skillGroups = useMemo(() => {
    const enabledSet = new Set(visibleSkills);
    const groups = new Map<string, typeof modeSkills>();
    for (const skill of modeSkills) {
      const key = skill.groupKey?.trim() || 'other';
      const bucket = groups.get(key);
      if (bucket) bucket.push(skill); else groups.set(key, [skill]);
    }
    return [...groups.entries()]
      .map(([key, skills]) => ({
        key,
        label: getSkillGroupLabel(key, t),
        skills,
        enabledCount: skills.filter((s) => enabledSet.has(s.key)).length,
      }))
      .sort((a, b) => (SKILL_GROUP_ORDER[a.key] ?? 50) - (SKILL_GROUP_ORDER[b.key] ?? 50));
  }, [modeSkills, t, visibleSkills]);

  return (
    <div className="apps-detail">
      <div className="apps-detail__scroll">
        <div className="apps-detail__breadcrumb">
          <Button variant="ghost" size="small" className="apps-detail__back" onClick={onBack}>
            <ArrowLeft size={14} />
            <span>
              {app?.kind === 'mode-app' || app?.kind === 'standalone-agent-app'
                ? (app.dynamicName ?? t(app.nameKey))
                : t('page.sectionTitle')}
            </span>
          </Button>
          <ChevronRight size={12} className="apps-detail__crumb-sep" />
          <span className="apps-detail__crumb-current">{agent.name}</span>
        </div>

        <header className="apps-detail__hero">
          <span className="apps-detail__icon"><Icon size={28} strokeWidth={1.5} /></span>
          <div className="apps-detail__identity">
            <h1 className="apps-detail__title">{agent.name}</h1>
            <p className="apps-detail__subtitle">{agent.description || t('agent.noDescription')}</p>
            <div className="apps-detail__badges">
              <Badge variant={getAgentBadge(t).variant}>{t('agent.badges.agent')}</Badge>
              {!agent.enabled ? <Badge variant="neutral">{t('agent.badges.disabled')}</Badge> : null}
            </div>
          </div>
        </header>

        {agent.capabilities.length > 0 && (
          <section className="apps-detail__section">
            <h3 className="apps-detail__section-title">{t('agent.sections.capabilities')}</h3>
            <div className="apps-detail__caps">
              {agent.capabilities.map((cap) => (
                <div key={cap.category} className="apps-detail__cap-row">
                  <span className="apps-detail__cap-name" style={{ color: CAPABILITY_ACCENT[cap.category] }}>{cap.category}</span>
                  <span className="apps-detail__cap-bar">
                    {Array.from({ length: 5 }).map((_, i) => (
                      <span key={i} className="apps-detail__cap-pip"
                        style={i < cap.level ? { backgroundColor: CAPABILITY_ACCENT[cap.category] } : undefined} />
                    ))}
                  </span>
                  <span className="apps-detail__cap-level">{cap.level}/5</span>
                </div>
              ))}
            </div>
          </section>
        )}

        <section className="apps-detail__section">
          <div className="apps-detail__section-head">
            <h3 className="apps-detail__section-title">
              {t('agent.sections.tools')}
              <span className="apps-detail__section-count">{visibleTools.length}/{availableTools.length}</span>
            </h3>
            <div className="apps-detail__section-actions">
              {toolsEditing ? (
                <>
                  <Button variant="ghost" size="small" onClick={async () => {
                    await handleResetTools(agent.id);
                    setToolsEditing(false); setPendingTools(null);
                  }}><RefreshCw size={12} /><span>{t('agent.actions.resetTools')}</span></Button>
                  <Button variant="ghost" size="small" onClick={() => { setToolsEditing(false); setPendingTools(null); }}>{t('agent.actions.cancel')}</Button>
                  <Button variant="primary" size="small" isLoading={savingTools} onClick={async () => {
                    if (!pendingTools) { setToolsEditing(false); return; }
                    setSavingTools(true);
                    try { await handleSetTools(agent.id, pendingTools); }
                    finally { setSavingTools(false); setToolsEditing(false); setPendingTools(null); }
                  }}>{t('agent.actions.save')}</Button>
                </>
              ) : (
                <Button variant="secondary" size="small" onClick={() => { setPendingTools([...activeTools]); setToolsEditing(true); }}>
                  {t('agent.actions.editTools')}
                </Button>
              )}
            </div>
          </div>
          <div className="apps-detail__chip-grid">
            {(toolsEditing ? availableTools : activeTools.map((name) => ({ name, description: '' })))
              .sort((a, b) => {
                const draft = pendingTools ?? activeTools;
                const aOn = draft.includes(a.name);
                const bOn = draft.includes(b.name);
                if (aOn === bOn) return a.name.localeCompare(b.name);
                return aOn ? -1 : 1;
              })
              .map((tool) => {
                const isOn = visibleTools.includes(tool.name);
                if (toolsEditing) {
                  return (
                    <Button
                      key={tool.name}
                      variant="ghost"
                      size="small"
                      title={tool.description || tool.name}
                      className={['apps-detail__chip', isOn && 'is-on'].filter(Boolean).join(' ')}
                      onClick={() => setPendingTools((prev) => {
                        const cur = prev ?? activeTools;
                        return cur.includes(tool.name) ? cur.filter((n) => n !== tool.name) : [...cur, tool.name];
                      })}
                    >
                      {tool.name}
                    </Button>
                  );
                }

                return (
                  <span
                    key={tool.name}
                    className={['apps-detail__chip', isOn && 'is-on', 'is-static'].filter(Boolean).join(' ')}
                  >
                    {tool.name}
                  </span>
                );
              })}
          </div>
        </section>

        {hasSkillTool && modeSkills.length > 0 && (
          <section className="apps-detail__section">
            <div className="apps-detail__section-head">
              <h3 className="apps-detail__section-title">
                {t('agent.sections.skills')}
                <span className="apps-detail__section-count">{visibleSkills.length}/{modeSkills.length}</span>
              </h3>
              <div className="apps-detail__section-actions">
                {skillsEditing ? (
                  <>
                    <Button variant="ghost" size="small" onClick={() => { setSkillsEditing(false); setPendingSkills(null); }}>{t('agent.actions.cancel')}</Button>
                    <Button variant="primary" size="small" isLoading={savingSkills} onClick={async () => {
                      if (!pendingSkills) { setSkillsEditing(false); return; }
                      setSavingSkills(true);
                      try { await handleSetSkills(agent.id, pendingSkills); }
                      finally { setSavingSkills(false); setSkillsEditing(false); setPendingSkills(null); }
                    }}>{t('agent.actions.save')}</Button>
                  </>
                ) : (
                  <Button variant="secondary" size="small" onClick={() => { setPendingSkills([...activeSkillKeys]); setSkillsEditing(true); }}>
                    {t('agent.actions.editSkills')}
                  </Button>
                )}
              </div>
            </div>
            <div className="apps-detail__skill-groups">
              {skillGroups.map((group) => (
                <div key={group.key} className="apps-detail__skill-group">
                  <div className="apps-detail__skill-group-head">
                    <span className="apps-detail__skill-group-title"><Sparkles size={11} />{group.label}</span>
                    <span className="apps-detail__skill-group-count">{group.enabledCount}/{group.skills.length}</span>
                  </div>
                  <div className="apps-detail__chip-grid">
                    {group.skills.map((skill) => {
                      const draft = pendingSkills ?? activeSkillKeys;
                      const isOn = draft.includes(skill.key);
                      if (skillsEditing) {
                        return (
                          <Button
                            key={skill.key}
                            variant="ghost"
                            size="small"
                            title={skill.description || skill.name}
                            className={['apps-detail__chip', isOn && 'is-on'].filter(Boolean).join(' ')}
                            onClick={() => setPendingSkills((prev) => {
                              const cur = prev ?? activeSkillKeys;
                              return cur.includes(skill.key) ? cur.filter((k) => k !== skill.key) : [...cur, skill.key];
                            })}
                          >
                            {skill.name}
                          </Button>
                        );
                      }

                      return (
                        <span
                          key={skill.key}
                          className={['apps-detail__chip', isOn && 'is-on', 'is-static'].filter(Boolean).join(' ')}
                        >
                          {skill.name}
                        </span>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        <section className="apps-detail__section apps-detail__section--meta">
          <div className="apps-detail__meta-item">
            <span className="apps-detail__meta-label">{t('agent.meta.enabled')}</span>
            <Switch
              size="small"
              checked={agent.enabled}
              disabled={!agent.isAgentApp}
              loading={savingEnabled}
              onChange={async (event) => {
                const nextEnabled = event.currentTarget.checked;
                setSavingEnabled(true);
                try {
                  await handleSetAgentEnabled(agent.id, nextEnabled);
                } finally {
                  setSavingEnabled(false);
                }
              }}
            />
          </div>
          {agent.isReadonly ? <Badge variant="neutral">{t('agent.meta.readonly')}</Badge> : null}
        </section>
      </div>
    </div>
  );
};
