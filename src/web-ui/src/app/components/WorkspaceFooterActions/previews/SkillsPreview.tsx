import React, { useMemo } from 'react';
import { BookOpen, Layers3, Package, TrendingUp } from 'lucide-react';
import { IconButton } from '@/design-system';
import { configAPI } from '@/infrastructure/api';
import type {
  SkillCatalog,
  SkillInfo,
  SkillMarketItem,
} from '@/infrastructure/config/types';
import { useLastUsedWorkspace } from '@/infrastructure/contexts/WorkspaceContext';
import { useI18n } from '@/infrastructure/i18n/hooks/useI18n';
import {
  WorkspaceHubPreviewEmpty,
  WorkspaceHubPreviewError,
  WorkspaceHubPreviewFrame,
  WorkspaceHubPreviewLoading,
} from './WorkspaceHubPreviewFrame';
import type { WorkspaceHubPreviewProps } from './workspaceHubPreviewTypes';
import { useHubPreviewResource } from './useHubPreviewResource';
import './SkillsPreview.scss';

interface SkillsPreviewData {
  catalog: SkillCatalog | null;
  market: SkillMarketItem[] | null;
}

function installedPriority(skill: SkillInfo): number {
  if (!skill.isBuiltin && skill.level === 'project') return 0;
  if (!skill.isBuiltin && skill.level === 'user') return 1;
  return 2;
}

const SkillsPreview: React.FC<WorkspaceHubPreviewProps> = ({
  label,
  primaryActionRef,
  onOpenItem,
}) => {
  const { t } = useI18n('common');
  const { workspacePath } = useLastUsedWorkspace();
  const key = `workspace-hub:skills:${workspacePath || 'global'}`;

  const resource = useHubPreviewResource<SkillsPreviewData>(key, async () => {
    const [catalogResult, marketResult] = await Promise.allSettled([
      configAPI.getSkillConfigs({ workspacePath: workspacePath || undefined }),
      configAPI.listSkillMarket(undefined, 8),
    ]);
    if (catalogResult.status === 'rejected' && marketResult.status === 'rejected') {
      throw catalogResult.reason;
    }
    return {
      catalog: catalogResult.status === 'fulfilled' ? catalogResult.value : null,
      market: marketResult.status === 'fulfilled' ? marketResult.value : null,
    };
  });

  const installedSkills = useMemo(
    () => [...(resource.data?.catalog?.skills ?? [])]
      .sort((left, right) => installedPriority(left) - installedPriority(right) || left.name.localeCompare(right.name))
      .slice(0, 3),
    [resource.data?.catalog?.skills],
  );
  const marketSkills = useMemo(() => {
    const installedNames = new Set((resource.data?.catalog?.skills ?? []).map((skill) => skill.name));
    return [...(resource.data?.market ?? [])]
      .filter((skill) => !installedNames.has(skill.name))
      .sort((left, right) => right.installs - left.installs)
      .slice(0, 3);
  }, [resource.data?.catalog?.skills, resource.data?.market]);

  const catalog = resource.data?.catalog;
  const counts = useMemo(() => {
    const skills = catalog?.skills ?? [];
    return {
      installed: skills.length,
      project: skills.filter((skill) => !skill.isBuiltin && skill.level === 'project').length,
      suites: catalog?.suites.length ?? 0,
    };
  }, [catalog]);

  const skillScopeLabel = (skill: SkillInfo): string => {
    if (skill.isBuiltin) return t('nav.menuPanel.hub.preview.skills.scope.builtin');
    return t(`nav.menuPanel.hub.preview.skills.scope.${skill.level}`);
  };

  return (
    <WorkspaceHubPreviewFrame
      title={label}
      className="sparo-workspace-hub-skills-preview"
      headerMeta={(
        <IconButton
          ref={primaryActionRef}
          variant="brand"
          size="medium"
          shape="circle"
          aria-label={t('nav.menuPanel.hub.preview.skills.actions.open')}
          tooltip={t('nav.menuPanel.hub.preview.skills.actions.open')}
          tooltipPlacement="top"
          onClick={() => onOpenItem('skills')}
        >
          <BookOpen size={16} aria-hidden="true" />
        </IconButton>
      )}
    >
      {resource.loading && !resource.data ? (
        <div className="sparo-workspace-hub-preview__wide">
          <WorkspaceHubPreviewLoading rows={3} />
        </div>
      ) : resource.error || !resource.data ? (
        <div className="sparo-workspace-hub-preview__wide">
          <WorkspaceHubPreviewError
            message={t('nav.menuPanel.hub.preview.skills.errors.load')}
            retryLabel={t('nav.menuPanel.hub.preview.common.retry')}
            onRetry={resource.refresh}
          />
        </div>
      ) : (
        <div className="sparo-workspace-hub-preview__wide sparo-workspace-hub-skills-preview__body">
          <div className="sparo-workspace-hub-skills-preview__stats" aria-label={label}>
            <span>
              <strong>{counts.installed}</strong>
              {t('nav.menuPanel.hub.preview.skills.metrics.installed')}
            </span>
            <span>
              <strong>{counts.project}</strong>
              {t('nav.menuPanel.hub.preview.skills.metrics.project')}
            </span>
            <span>
              <strong>{counts.suites}</strong>
              {t('nav.menuPanel.hub.preview.skills.metrics.suites')}
            </span>
          </div>

          <section className="sparo-workspace-hub-skills-preview__shelf">
            <h3>{t('nav.menuPanel.hub.preview.skills.sections.available')}</h3>
            {!catalog ? (
              <WorkspaceHubPreviewError
                message={t('nav.menuPanel.hub.preview.skills.errors.installed')}
                retryLabel={t('nav.menuPanel.hub.preview.common.retry')}
                onRetry={resource.refresh}
              />
            ) : installedSkills.length ? (
              <div className="sparo-workspace-hub-skills-preview__books" role="list">
                {installedSkills.map((skill) => (
                  <div
                    key={skill.key}
                    role="listitem"
                    className={`sparo-workspace-hub-skills-preview__book${skill.level === 'project' && !skill.isBuiltin ? ' is-project' : ''}`}
                    title={skill.description}
                  >
                    <span aria-hidden="true">
                      {skill.suiteKey ? <Layers3 size={16} /> : <BookOpen size={16} />}
                    </span>
                    <strong>{skill.name}</strong>
                    <small>{skillScopeLabel(skill)}</small>
                  </div>
                ))}
              </div>
            ) : (
              <WorkspaceHubPreviewEmpty
                title={t('nav.menuPanel.hub.preview.skills.empty.installedTitle')}
              />
            )}
          </section>

          <section className="sparo-workspace-hub-skills-preview__discover">
            <h3>{t('nav.menuPanel.hub.preview.skills.sections.popular')}</h3>
            {resource.data.market === null ? (
              <WorkspaceHubPreviewError
                message={t('nav.menuPanel.hub.preview.skills.errors.market')}
                retryLabel={t('nav.menuPanel.hub.preview.common.retry')}
                onRetry={resource.refresh}
              />
            ) : marketSkills.length ? (
              <div className="sparo-workspace-hub-skills-preview__discover-strip" role="list">
                {marketSkills.map((skill, index) => (
                  <div
                    key={skill.id}
                    role="listitem"
                    className={`sparo-workspace-hub-skills-preview__discover-item${index === 0 ? ' is-trending' : ''}`}
                    title={skill.description}
                  >
                    <span aria-hidden="true">
                      {index === 0 ? <TrendingUp size={15} /> : <Package size={15} />}
                    </span>
                    <strong>{skill.name}</strong>
                    <small>{t('nav.menuPanel.hub.preview.skills.meta.installs', { count: skill.installs })}</small>
                  </div>
                ))}
              </div>
            ) : (
              <WorkspaceHubPreviewEmpty
                title={t('nav.menuPanel.hub.preview.skills.empty.marketTitle')}
              />
            )}
          </section>
        </div>
      )}
    </WorkspaceHubPreviewFrame>
  );
};

export default SkillsPreview;
