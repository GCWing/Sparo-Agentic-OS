/**
 * AppDetailScene — the single workbench page for an Agent App.
 *
 * Owns the page chrome (header, tabs), data fetching for cross-tab resources
 * (subagents), and the global Dirty Bar that aggregates Agent drafts.
 *
 * IA:
 *   Overview / Agents / Shared / Runtime / History
 *
 * Agents is where per-agent configuration lives. Each top-level Agent the App
 * ships with appears as one configurable Agent. The other tabs are read-only or scaffolded
 * surfaces tracking the design contract (see appsScene design notes).
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  ArrowLeft,
  Boxes,
  History as HistoryIcon,
  Layers,
  LayoutDashboard,
  Play,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  Button,
  DetailHeader,
  NavigationList,
  NavigationListItem,
  SparoAgentIcon,
} from '@/design-system';
import { SubagentAPI, type SubagentInfo } from '@/infrastructure/api/service-api/SubagentAPI';
import {
  useLastUsedWorkspace,
  useWorkspaceContext,
} from '@/infrastructure/contexts/WorkspaceContext';
import { notificationService } from '@/shared/notification-system';
import { createLogger } from '@/shared/utils/logger';
import { launchWorkForChoice } from '@/app/components/WorkDock/NewWorkDialog';
import { APP_ICON_MAP } from '../appVisuals';
import type { AppCardModel } from '../hooks/useAppsData';
import type { useAppsData } from '../hooks/useAppsData';
import { useAppDetailStore } from './appDetailStore';
import { APP_DETAIL_TABS, type AppDetailTab } from './types';
import { OverviewTab } from './tabs/OverviewTab';
import { AgentsTab } from './tabs/AgentsTab';
import { SharedTab } from './tabs/SharedTab';
import { RuntimeTab } from './tabs/RuntimeTab';
import { HistoryTab } from './tabs/HistoryTab';
import { DirtyBar, type DirtyEntry } from './components/DirtyBar';
import './AppDetailScene.scss';

const log = createLogger('AppDetailScene');

type AppsData = ReturnType<typeof useAppsData>;

interface AppDetailSceneProps {
  app: AppCardModel;
  appsData: AppsData;
  onBack: () => void;
}

export const AppDetailScene: React.FC<AppDetailSceneProps> = ({ app, appsData, onBack }) => {
  const { t } = useTranslation('scenes/apps');
  const { workspacePath } = useLastUsedWorkspace();
  const { rememberWorkspace } = useWorkspaceContext();

  const tab = useAppDetailStore((s) => s.tab);
  const setTab = useAppDetailStore((s) => s.setTab);
  const setAgentId = useAppDetailStore((s) => s.setAgentId);
  const toolsDrafts = useAppDetailStore((s) => s.toolsDrafts);
  const skillsDrafts = useAppDetailStore((s) => s.skillsDrafts);
  const subagentsDrafts = useAppDetailStore((s) => s.subagentsDrafts);
  const setToolsDraft = useAppDetailStore((s) => s.setToolsDraft);
  const setSkillsDraft = useAppDetailStore((s) => s.setSkillsDraft);
  const setSubagentsDraft = useAppDetailStore((s) => s.setSubagentsDraft);
  const resetForApp = useAppDetailStore((s) => s.resetForApp);

  const [subagents, setSubagents] = useState<SubagentInfo[]>([]);
  const [subagentsLoading, setSubagentsLoading] = useState(false);
  const [savingDrafts, setSavingDrafts] = useState(false);

  useEffect(() => {
    resetForApp();
  }, [app.id, resetForApp]);

  useEffect(() => {
    let cancelled = false;
    setSubagentsLoading(true);
    SubagentAPI.listSubagents({ workspacePath: workspacePath || undefined })
      .then((list) => {
        if (!cancelled) setSubagents(list);
      })
      .catch((error) => {
        log.warn('Failed to load subagents', { error });
        if (!cancelled) setSubagents([]);
      })
      .finally(() => {
        if (!cancelled) setSubagentsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [workspacePath, app.id]);

  const dirtyEntries: DirtyEntry[] = useMemo(() => {
    const entries: DirtyEntry[] = [];
    for (const agent of app.includedAgents) {
      const t = toolsDrafts[agent.id];
      if (t) {
        entries.push({
          id: `tools:${agent.id}`,
          agentId: agent.id,
          agentName: agent.name,
          kind: 'tools',
          count: t.length,
        });
      }
      const s = skillsDrafts[agent.id];
      if (s) {
        entries.push({
          id: `skills:${agent.id}`,
          agentId: agent.id,
          agentName: agent.name,
          kind: 'skills',
          count: s.length,
        });
      }
      const subagents = subagentsDrafts[agent.id];
      if (subagents) {
        entries.push({
          id: `subagents:${agent.id}`,
          agentId: agent.id,
          agentName: agent.name,
          kind: 'subagents',
          count: subagents.length,
        });
      }
    }
    return entries;
  }, [app.includedAgents, toolsDrafts, skillsDrafts, subagentsDrafts]);

  const handleSaveAll = useCallback(async () => {
    setSavingDrafts(true);
    try {
      const tasks: Array<Promise<void>> = [];
      for (const [agentId, tools] of Object.entries(toolsDrafts)) {
        tasks.push(appsData.handleSetTools(agentId, tools));
      }
      for (const [agentId, skills] of Object.entries(skillsDrafts)) {
        tasks.push(appsData.handleSetSkills(agentId, skills));
      }
      for (const [agentId, subagentIds] of Object.entries(subagentsDrafts)) {
        tasks.push(appsData.handleSetSubagents(agentId, subagentIds));
      }
      await Promise.all(tasks);
      for (const agentId of Object.keys(toolsDrafts)) setToolsDraft(agentId, null);
      for (const agentId of Object.keys(skillsDrafts)) setSkillsDraft(agentId, null);
      for (const agentId of Object.keys(subagentsDrafts)) setSubagentsDraft(agentId, null);
      notificationService.success(t('appDetail.dirtyBar.saveOk'), { duration: 2000 });
    } catch (error) {
      log.error('Failed to save drafts', { error });
      notificationService.error(t('appDetail.dirtyBar.saveFailed'));
    } finally {
      setSavingDrafts(false);
    }
  }, [appsData, toolsDrafts, skillsDrafts, subagentsDrafts, setToolsDraft, setSkillsDraft, setSubagentsDraft, t]);

  const handleDiscardAll = useCallback(() => {
    for (const agentId of Object.keys(toolsDrafts)) setToolsDraft(agentId, null);
    for (const agentId of Object.keys(skillsDrafts)) setSkillsDraft(agentId, null);
    for (const agentId of Object.keys(subagentsDrafts)) setSubagentsDraft(agentId, null);
  }, [toolsDrafts, skillsDrafts, subagentsDrafts, setToolsDraft, setSkillsDraft, setSubagentsDraft]);

  const handleJumpDraft = useCallback(
    (entry: DirtyEntry) => {
      setTab('agents');
      setAgentId(entry.agentId);
      requestAnimationFrame(() => {
        document
          .getElementById(`app-detail-section-${entry.kind}`)
          ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    },
    [setTab, setAgentId],
  );

  const handleStartSession = useCallback(async () => {
    const entryAgent = app.includedAgents[0];
    if (!entryAgent) return;
    try {
      await launchWorkForChoice({
        agentChoice: entryAgent.id,
        workspace: null,
        rememberWorkspace,
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      notificationService.error(`${t('appDetail.actions.startSession')}: ${reason}`);
    }
  }, [app.includedAgents, rememberWorkspace, t]);

  const displayName = app.dynamicName ?? t(app.nameKey);
  const displayDesc = app.dynamicDescription ?? t(app.descriptionKey);

  return (
    <div className="app-detail-scene">
      <DetailHeader
        className="app-detail-scene__header"
        title={
          <span className="app-detail-scene__title-row">
            <Button
              variant="ghost"
              size="small"
              className="app-detail-scene__back"
              onClick={onBack}
              aria-label={t('page.sectionTitle')}
            >
              <ArrowLeft size={14} aria-hidden="true" />
              <span>{t('tabs.agent-app')}</span>
            </Button>
            <span className="app-detail-scene__title-sep" aria-hidden="true">
              /
            </span>
            <span className="app-detail-scene__app-name">{displayName}</span>
          </span>
        }
        subtitle={displayDesc}
        actions={
          <div className="app-detail-scene__header-actions">
            {app.includedAgents.length > 0 ? (
              <nav
                className="app-detail-scene__agent-rail"
                aria-label={t('appDetail.agents.switcherLabel')}
              >
                {app.includedAgents.map((agent, index) => {
                  const AgentIcon =
                    APP_ICON_MAP[(agent.iconKey ?? 'bot') as keyof typeof APP_ICON_MAP] ??
                    SparoAgentIcon;
                  return (
                    <button
                      key={agent.id}
                      type="button"
                      className="app-detail-scene__agent-chip"
                      data-default={index === 0 ? 'true' : undefined}
                      onClick={() => {
                        setAgentId(agent.id);
                        setTab('agents');
                      }}
                      title={agent.description || agent.name}
                    >
                      <AgentIcon size={13} strokeWidth={1.75} aria-hidden="true" />
                      <span>{agent.name}</span>
                    </button>
                  );
                })}
              </nav>
            ) : null}
            <Button variant="primary" size="small" onClick={() => void handleStartSession()}>
              <Play size={13} />
              <span>{t('appDetail.actions.startSession')}</span>
            </Button>
          </div>
        }
      />

      <div className="app-detail-scene__body">
        <aside
          className="app-detail-scene__side"
          aria-label={t('appDetail.nav.label')}
        >
          <div className="app-detail-scene__side-inner">
            <div className="app-detail-scene__side-heading">
              {t('appDetail.nav.heading')}
            </div>
            <NavigationList variant="plain">
              {APP_DETAIL_TABS.map((key) => (
                <NavigationListItem
                  key={key}
                  icon={<TabIcon tabKey={key} />}
                  active={tab === key}
                  onClick={() => setTab(key)}
                >
                  {t(`appDetail.tabs.${key}`)}
                </NavigationListItem>
              ))}
            </NavigationList>
          </div>
        </aside>
        <div className="app-detail-scene__main">
          {renderTabBody(tab, {
            app,
            appsData,
            subagents,
            subagentsLoading,
          })}
        </div>
      </div>

      <DirtyBar
        entries={dirtyEntries}
        saving={savingDrafts}
        onSave={handleSaveAll}
        onDiscard={handleDiscardAll}
        onJump={handleJumpDraft}
      />
    </div>
  );
};

function TabIcon({ tabKey }: { tabKey: AppDetailTab }) {
  const props = { size: 14, strokeWidth: 1.75 } as const;
  switch (tabKey) {
    case 'overview':
      return <LayoutDashboard {...props} />;
    case 'agents':
      return <Layers {...props} />;
    case 'shared':
      return <Boxes {...props} />;
    case 'runtime':
      return <Activity {...props} />;
    case 'history':
      return <HistoryIcon {...props} />;
    default:
      return null;
  }
}

function renderTabBody(
  key: AppDetailTab,
  ctx: {
    app: AppCardModel;
    appsData: AppsData;
    subagents: SubagentInfo[];
    subagentsLoading: boolean;
  },
): React.ReactNode {
  switch (key) {
    case 'overview':
      return (
        <OverviewTab
          app={ctx.app}
          subagents={ctx.subagents}
          getAgentConfig={ctx.appsData.getAgentConfig}
          getModelDisplayName={ctx.appsData.getModelDisplayName}
        />
      );
    case 'agents':
      return (
        <AgentsTab
          app={ctx.app}
          availableTools={ctx.appsData.availableTools}
          subagentsLoading={ctx.subagentsLoading}
          getAgentConfig={ctx.appsData.getAgentConfig}
          getAgentSkills={ctx.appsData.getAgentSkills}
          getAgentSubagents={ctx.appsData.getAgentSubagents}
          getModelDisplayName={ctx.appsData.getModelDisplayName}
        />
      );
    case 'shared':
      return <SharedTab />;
    case 'runtime':
      return <RuntimeTab />;
    case 'history':
      return <HistoryTab />;
    default:
      return null;
  }
}
