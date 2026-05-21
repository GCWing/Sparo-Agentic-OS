/**
 * Agents tab - the configuration core.
 *
 * Layout (top to bottom):
 *   - {@link AgentSwitcher} (sticky) selects the active Agent.
 *   - A centered, max-width workspace renders the Agent's Sections in fixed order.
 *   - {@link AgentTOC} (sticky right rail) anchors to Sections with scrollspy.
 *
 * Sections that touch the backend today (Tools, Skills) own draft state via
 * the shared {@link useAppDetailStore}; the rest are schema-driven placeholders
 * waiting on their respective backend APIs.
 */
import { useEffect, useMemo } from 'react';
import { ChevronRight, Sparkles } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button, EmptyState } from '@/design-system';
import type { AgentSubagentInfo } from '@/infrastructure/api/service-api/SubagentAPI';
import type { AgentSkillInfo, AgentCapabilityConfigItem } from '@/infrastructure/config/types';
import { CAPABILITY_ACCENT } from '../../appVisuals';
import type {
  AgentWithCapabilities,
  AppCardModel,
  ToolInfo,
} from '../../hooks/useAppsData';
import { useAppDetailStore } from '../appDetailStore';
import { AGENT_SECTION_KEYS, type AgentSectionKey } from '../types';
import { SectionCard } from '../components/SectionCard';
import { ChipGrid, type ChipOption } from '../components/ChipGrid';
import { AgentSwitcher, type AgentSwitcherItem } from '../components/AgentSwitcher';
import { AgentTOC, type AgentTOCItem } from '../components/AgentTOC';

interface AgentsTabProps {
  app: AppCardModel;
  availableTools: ToolInfo[];
  subagentsLoading: boolean;
  getAgentConfig: (agentId: string) => AgentCapabilityConfigItem | null;
  getAgentSkills: (agentId: string) => AgentSkillInfo[];
  getAgentSubagents: (agentId: string) => AgentSubagentInfo[];
  getModelDisplayName: (modelRef?: string | null) => string;
}

const SKILL_GROUP_ORDER: Record<string, number> = {
  office: 0,
  'computer-use': 1,
  meta: 2,
  team: 3,
  superpowers: 4,
};

function getSkillGroupLabel(key: string, t: (k: string) => string): string {
  switch (key) {
    case 'office':
      return t('appDetail.skillGroups.office');
    case 'computer-use':
      return t('appDetail.skillGroups.computerUse');
    case 'meta':
      return t('appDetail.skillGroups.meta');
    case 'team':
      return t('appDetail.skillGroups.team');
    case 'superpowers':
      return t('appDetail.skillGroups.superpowers');
    default:
      return t('appDetail.skillGroups.other');
  }
}

export function AgentsTab({
  app,
  availableTools,
  subagentsLoading,
  getAgentConfig,
  getAgentSkills,
  getAgentSubagents,
  getModelDisplayName,
}: AgentsTabProps) {
  const { t } = useTranslation('scenes/apps');
  const agentId = useAppDetailStore((s) => s.agentId);
  const setAgentId = useAppDetailStore((s) => s.setAgentId);
  const toolsDrafts = useAppDetailStore((s) => s.toolsDrafts);
  const skillsDrafts = useAppDetailStore((s) => s.skillsDrafts);
  const subagentsDrafts = useAppDetailStore((s) => s.subagentsDrafts);

  const agents = app.includedAgents;
  const activeAgent = useMemo(
    () => agents.find((m) => m.id === agentId) ?? agents[0] ?? null,
    [agents, agentId],
  );

  useEffect(() => {
    if (!agentId && agents[0]) setAgentId(agents[0].id);
  }, [agentId, agents, setAgentId]);

  const switcherItems: AgentSwitcherItem[] = useMemo(
    () =>
      agents.map((agent, index) => {
        const toolsCount = toolsDrafts[agent.id] ? 1 : 0;
        const skillsCount = skillsDrafts[agent.id] ? 1 : 0;
        const subagentsCount = subagentsDrafts[agent.id] ? 1 : 0;
        const dirtyCount = toolsCount + skillsCount + subagentsCount;
        return {
          agent,
          isDefault: index === 0,
          isDirty: dirtyCount > 0,
          dirtyCount,
        };
      }),
    [agents, toolsDrafts, skillsDrafts, subagentsDrafts],
  );

  const tocItems: AgentTOCItem[] = useMemo(() => {
    if (!activeAgent) return [];
    return AGENT_SECTION_KEYS.map((key) => ({
      key,
      id: sectionElementId(key),
      label: t(`appDetail.sections.${key}.title`),
      dirty: isSectionDirty(key, activeAgent.id, toolsDrafts, skillsDrafts, subagentsDrafts),
    }));
  }, [activeAgent, toolsDrafts, skillsDrafts, subagentsDrafts, t]);

  if (agents.length === 0) {
    return (
      <EmptyState
        title={t('appDetail.agents.empty.title')}
        description={t('appDetail.agents.empty.description')}
      />
    );
  }

  if (!activeAgent) return null;

  const config = getAgentConfig(activeAgent.id);
  const skills = getAgentSkills(activeAgent.id);
  const agentSubagents = getAgentSubagents(activeAgent.id);

  return (
    <div className="app-detail-agents">
      <AgentSwitcher items={switcherItems} activeId={activeAgent.id} onSelect={setAgentId} />

      <div className="app-detail-agents__layout">
        <div className="app-detail-agents__main" key={activeAgent.id}>
          <IdentitySection agent={activeAgent} />
          <PersonaSection agent={activeAgent} config={config} />
          <ToolsSection agent={activeAgent} availableTools={availableTools} config={config} />
          <SkillsSection agent={activeAgent} skills={skills} config={config} />
          <SubagentsSection agent={activeAgent} subagents={agentSubagents} loading={subagentsLoading} />
          <ModelSection agent={activeAgent} getModelDisplayName={getModelDisplayName} />
          <MemorySection agent={activeAgent} />
          <GuardrailsSection agent={activeAgent} />
        </div>

        <AgentTOC items={tocItems} />
      </div>
    </div>
  );
}

function sectionElementId(key: AgentSectionKey): string {
  return `app-detail-section-${key}`;
}

function isSectionDirty(
  key: AgentSectionKey,
  agentId: string,
  toolsDrafts: Record<string, string[]>,
  skillsDrafts: Record<string, string[]>,
  subagentsDrafts: Record<string, string[]>,
): boolean {
  if (key === 'tools') return Boolean(toolsDrafts[agentId]);
  if (key === 'skills') return Boolean(skillsDrafts[agentId]);
  if (key === 'subagents') return Boolean(subagentsDrafts[agentId]);
  return false;
}

// ─────────────────────────────────────────────────────────────────────────────
// Sections
// ─────────────────────────────────────────────────────────────────────────────

const sectionId = sectionElementId;

function IdentitySection({ agent }: { agent: AgentWithCapabilities }) {
  const { t } = useTranslation('scenes/apps');
  return (
    <SectionCard
      id={sectionId('identity')}
      title={t('appDetail.sections.identity.title')}
      description={t('appDetail.sections.identity.description')}
    >
      <dl className="app-detail-field-list">
        <div className="app-detail-field-list__row">
          <dt>{t('appDetail.sections.identity.fields.id')}</dt>
          <dd>
            <code>{agent.id}</code>
          </dd>
        </div>
        <div className="app-detail-field-list__row">
          <dt>{t('appDetail.sections.identity.fields.name')}</dt>
          <dd>{agent.name}</dd>
        </div>
        <div className="app-detail-field-list__row">
          <dt>{t('appDetail.sections.identity.fields.description')}</dt>
          <dd>{agent.description || t('appDetail.agents.noDescription')}</dd>
        </div>
        {agent.capabilities.length > 0 ? (
          <div className="app-detail-field-list__row">
            <dt>{t('appDetail.sections.identity.fields.capabilities')}</dt>
            <dd>
              <ul className="app-detail-capabilities">
                {agent.capabilities.map((cap) => (
                  <li key={cap.category}>
                    <span
                      className="app-detail-capabilities__name"
                      style={{ color: CAPABILITY_ACCENT[cap.category] }}
                    >
                      {cap.category}
                    </span>
                    <span className="app-detail-capabilities__bar" aria-hidden="true">
                      {Array.from({ length: 5 }).map((_, i) => (
                        <span
                          key={i}
                          className="app-detail-capabilities__pip"
                          style={
                            i < cap.level
                              ? { backgroundColor: CAPABILITY_ACCENT[cap.category] }
                              : undefined
                          }
                        />
                      ))}
                    </span>
                    <span className="app-detail-capabilities__level">{cap.level}/5</span>
                  </li>
                ))}
              </ul>
            </dd>
          </div>
        ) : null}
      </dl>
    </SectionCard>
  );
}

function PersonaSection({ agent }: { agent: AgentWithCapabilities; config: AgentCapabilityConfigItem | null }) {
  const { t } = useTranslation('scenes/apps');
  return (
    <SectionCard
      id={sectionId('persona')}
      title={t('appDetail.sections.persona.title')}
      description={t('appDetail.sections.persona.description')}
    >
      <div className="app-detail-placeholder">
        <Sparkles size={14} />
        <span>{t('appDetail.sections.persona.placeholder', { agent: agent.name })}</span>
      </div>
    </SectionCard>
  );
}

function ToolsSection({
  agent,
  availableTools,
  config,
}: {
  agent: AgentWithCapabilities;
  availableTools: ToolInfo[];
  config: AgentCapabilityConfigItem | null;
}) {
  const { t } = useTranslation('scenes/apps');
  const draft = useAppDetailStore((s) => s.toolsDrafts[agent.id]);
  const setDraft = useAppDetailStore((s) => s.setToolsDraft);

  const active = config?.enabled_tools ?? agent.defaultTools ?? [];
  const editing = draft !== undefined;
  const value = draft ?? active;

  const options: ChipOption[] = useMemo(
    () =>
      availableTools.map((tool) => ({
        key: tool.name,
        label: tool.name,
        description: tool.description,
      })),
    [availableTools],
  );

  const handleToggle = (key: string) => {
    const current = draft ?? active;
    setDraft(
      agent.id,
      current.includes(key) ? current.filter((n) => n !== key) : [...current, key],
    );
  };

  return (
    <SectionCard
      id={sectionId('tools')}
      title={t('appDetail.sections.tools.title')}
      description={t('appDetail.sections.tools.description')}
      count={`${value.length}/${availableTools.length}`}
      dirty={editing}
      actions={
        editing ? (
          <Button variant="ghost" size="small" onClick={() => setDraft(agent.id, null)}>
            {t('appDetail.actions.discardChanges')}
          </Button>
        ) : (
          <Button
            variant="secondary"
            size="small"
            onClick={() => setDraft(agent.id, [...active])}
          >
            {t('appDetail.actions.edit')}
          </Button>
        )
      }
    >
      <ChipGrid
        options={options}
        enabled={value}
        editing={editing}
        onToggle={handleToggle}
        emptyLabel={t('appDetail.sections.tools.empty')}
      />
    </SectionCard>
  );
}

function SkillsSection({
  agent,
  skills,
  config,
}: {
  agent: AgentWithCapabilities;
  skills: AgentSkillInfo[];
  config: AgentCapabilityConfigItem | null;
}) {
  const { t } = useTranslation('scenes/apps');
  const draft = useAppDetailStore((s) => s.skillsDrafts[agent.id]);
  const setDraft = useAppDetailStore((s) => s.setSkillsDraft);

  const activeTools = config?.enabled_tools ?? agent.defaultTools ?? [];
  const hasSkillTool = activeTools.includes('Skill');
  const activeSkills = useMemo(
    () => skills.filter((s) => !s.disabledByAgent).map((s) => s.key),
    [skills],
  );

  const editing = draft !== undefined;
  const value = draft ?? activeSkills;

  const handleToggle = (key: string) => {
    const current = draft ?? activeSkills;
    setDraft(
      agent.id,
      current.includes(key) ? current.filter((k) => k !== key) : [...current, key],
    );
  };

  const groups = useMemo(() => {
    const enabledSet = new Set(value);
    const map = new Map<string, AgentSkillInfo[]>();
    for (const skill of skills) {
      const key = skill.groupKey?.trim() || 'other';
      const bucket = map.get(key);
      if (bucket) bucket.push(skill);
      else map.set(key, [skill]);
    }
    return [...map.entries()]
      .map(([key, list]) => ({
        key,
        label: getSkillGroupLabel(key, t),
        skills: list,
        enabledCount: list.filter((s) => enabledSet.has(s.key)).length,
      }))
      .sort((a, b) => (SKILL_GROUP_ORDER[a.key] ?? 50) - (SKILL_GROUP_ORDER[b.key] ?? 50));
  }, [skills, value, t]);

  if (skills.length === 0) {
    return (
      <SectionCard
        id={sectionId('skills')}
        title={t('appDetail.sections.skills.title')}
        description={t('appDetail.sections.skills.empty')}
      >
        <div className="app-detail-placeholder">
          <Sparkles size={14} />
          <span>{t('appDetail.sections.skills.empty')}</span>
        </div>
      </SectionCard>
    );
  }

  return (
    <SectionCard
      id={sectionId('skills')}
      title={t('appDetail.sections.skills.title')}
      description={
        hasSkillTool
          ? t('appDetail.sections.skills.description')
          : t('appDetail.sections.skills.needsSkillTool')
      }
      count={`${value.length}/${skills.length}`}
      dirty={editing}
      actions={
        !hasSkillTool ? null : editing ? (
          <Button variant="ghost" size="small" onClick={() => setDraft(agent.id, null)}>
            {t('appDetail.actions.discardChanges')}
          </Button>
        ) : (
          <Button
            variant="secondary"
            size="small"
            onClick={() => setDraft(agent.id, [...activeSkills])}
          >
            {t('appDetail.actions.edit')}
          </Button>
        )
      }
    >
      <div className="app-detail-skill-groups">
        {groups.map((group) => (
          <div key={group.key} className="app-detail-skill-group">
            <div className="app-detail-skill-group__head">
              <span className="app-detail-skill-group__title">
                <Sparkles size={11} />
                {group.label}
              </span>
              <span className="app-detail-skill-group__count">
                {group.enabledCount}/{group.skills.length}
              </span>
            </div>
            <ChipGrid
              options={group.skills.map((s) => ({
                key: s.key,
                label: s.name,
                description: s.description,
              }))}
              enabled={value}
              editing={editing && hasSkillTool}
              onToggle={handleToggle}
            />
          </div>
        ))}
      </div>
    </SectionCard>
  );
}

function SubagentsSection({
  agent,
  subagents,
  loading,
}: {
  agent: AgentWithCapabilities;
  subagents: AgentSubagentInfo[];
  loading: boolean;
}) {
  const { t } = useTranslation('scenes/apps');
  const draft = useAppDetailStore((s) => s.subagentsDrafts[agent.id]);
  const setDraft = useAppDetailStore((s) => s.setSubagentsDraft);
  const activeSubagents = useMemo(
    () => subagents.filter((subagent) => !subagent.disabledByAgent).map((subagent) => subagent.id),
    [subagents],
  );
  const editing = draft !== undefined;
  const value = draft ?? activeSubagents;

  const handleToggle = (key: string) => {
    const current = draft ?? activeSubagents;
    setDraft(
      agent.id,
      current.includes(key) ? current.filter((id) => id !== key) : [...current, key],
    );
  };

  return (
    <SectionCard
      id={sectionId('subagents')}
      title={t('appDetail.sections.subagents.title')}
      description={t('appDetail.sections.subagents.description')}
      count={`${value.length}/${subagents.length}`}
      dirty={editing}
      actions={
        editing ? (
          <Button variant="ghost" size="small" onClick={() => setDraft(agent.id, null)}>
            {t('appDetail.actions.discardChanges')}
          </Button>
        ) : (
          <Button
            variant="secondary"
            size="small"
            onClick={() => setDraft(agent.id, [...activeSubagents])}
          >
            {t('appDetail.actions.edit')}
          </Button>
        )
      }
    >
      {loading ? (
        <div className="app-detail-placeholder">{t('appDetail.loading')}</div>
      ) : subagents.length === 0 ? (
        <div className="app-detail-placeholder">
          {t('appDetail.sections.subagents.empty')}
        </div>
      ) : (
        <ChipGrid
          options={subagents.map((subagent) => ({
            key: subagent.id,
            label: subagent.name,
            description: subagent.description || t(`appDetail.sections.subagents.source.${subagent.subagentSource ?? 'builtin'}`),
          }))}
          enabled={value}
          editing={editing}
          onToggle={handleToggle}
          emptyLabel={t('appDetail.sections.subagents.empty')}
        />
      )}
    </SectionCard>
  );
}

function ModelSection({
  agent,
  getModelDisplayName,
}: {
  agent: AgentWithCapabilities;
  getModelDisplayName: (modelRef?: string | null) => string;
}) {
  const { t } = useTranslation('scenes/apps');
  return (
    <SectionCard
      id={sectionId('model')}
      title={t('appDetail.sections.model.title')}
      description={t('appDetail.sections.model.description')}
    >
      <dl className="app-detail-field-list">
        <div className="app-detail-field-list__row">
          <dt>{t('appDetail.sections.model.fields.model')}</dt>
          <dd>{agent.model ? getModelDisplayName(agent.model) : t('appDetail.sections.model.inherit')}</dd>
        </div>
      </dl>
      <p className="app-detail-section__hint">
        <ChevronRight size={12} />
        {t('appDetail.sections.model.hint')}
      </p>
    </SectionCard>
  );
}

function MemorySection(_props: { agent: AgentWithCapabilities }) {
  const { t } = useTranslation('scenes/apps');
  return (
    <SectionCard
      id={sectionId('memory')}
      title={t('appDetail.sections.memory.title')}
      description={t('appDetail.sections.memory.description')}
    >
      <div className="app-detail-placeholder">
        <ChevronRight size={12} />
        <span>{t('appDetail.sections.memory.placeholder')}</span>
      </div>
    </SectionCard>
  );
}

function GuardrailsSection({ agent }: { agent: AgentWithCapabilities }) {
  const { t } = useTranslation('scenes/apps');
  return (
    <SectionCard
      id={sectionId('guardrails')}
      title={t('appDetail.sections.guardrails.title')}
      description={t('appDetail.sections.guardrails.description')}
    >
      <dl className="app-detail-field-list">
        <div className="app-detail-field-list__row">
          <dt>{t('appDetail.sections.guardrails.fields.readonly')}</dt>
          <dd>
            {agent.isReadonly
              ? t('appDetail.sections.guardrails.readonlyOn')
              : t('appDetail.sections.guardrails.readonlyOff')}
          </dd>
        </div>
      </dl>
      <p className="app-detail-section__hint">
        <ChevronRight size={12} />
        {t('appDetail.sections.guardrails.hint')}
      </p>
    </SectionCard>
  );
}


