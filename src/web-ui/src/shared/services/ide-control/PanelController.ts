/**
 * Panel controller.
 *
 * Implements a subset of IDE control operations focused on opening/closing panels.
 */
import { i18nService } from '@/infrastructure/i18n';
import {
  IdeController,
  IdeControlEvent,
  IdeControlOptions,
  PanelType,
  PanelConfig,
  PanelOpenConfig,
} from './types';
import { createLogger } from '@/shared/utils/logger';
import { openProjectCanvasItem } from '@/app/components/panels/content-canvas/openCanvasItem';
import type {
  CanvasItemDescriptor,
  PanelContentType,
} from '@/app/components/panels/content-canvas/types';
import {
  openActiveAuxiliaryItem,
  toggleActiveAuxiliarySurface,
  useAuxiliarySurfaceStore,
} from '@/app/auxiliary-surface';
import {
  useAgentCanvasStore,
} from '@/app/components/panels/content-canvas/stores';

const log = createLogger('PanelController');

 
export class PanelController implements IdeController {
   
  async execute(
    target: IdeControlEvent['target'],
    options?: IdeControlOptions,
    metadata?: IdeControlEvent['metadata']
  ): Promise<void> {
    const panelType = target.type as PanelType;
    const config = target.config || {};
    const position = target.position || 'right';

    
    const openConfig: PanelOpenConfig = {
      panelType,
      position,
      config,
      options,
    };

    
    await this.openPanel(openConfig);

    
    if (metadata?.request_id) {
      this.sendExecutionResult(metadata.request_id, true, `Panel ${panelType} opened successfully`);
    }
  }

   
  async openPanel(config: PanelOpenConfig): Promise<void> {
    const { panelType, position, config: panelConfig, options } = config;

    
    const mode = options?.mode || 'agent';
    const tabDetail = this.buildTabDetail(panelType, panelConfig || {}, options);
    if (mode === 'project') {
      openProjectCanvasItem(tabDetail);
    } else {
      openActiveAuxiliaryItem(
        tabDetail,
        position === 'right' && options?.expand_panel === false ? 'preserve' : 'explicit',
      );
    }
  }

   
  async closePanel(panelType: PanelType): Promise<void> {
    const store = useAgentCanvasStore.getState();
    (['primary', 'secondary', 'tertiary'] as const).forEach(groupId => {
      const group =
        groupId === 'primary'
          ? store.primaryGroup
          : groupId === 'secondary'
            ? store.secondaryGroup
            : store.tertiaryGroup;
      group.tabs
        .filter(tab => tab.content.type === panelType)
        .forEach(tab => store.closeTab(tab.id, groupId, { forceRemove: true }));
    });
  }

   
  async togglePanel(panelType: PanelType): Promise<void> {
    const store = useAgentCanvasStore.getState();
    const existing = store.getAllTabs().find(tab => tab.content.type === panelType);
    if (existing) {
      toggleActiveAuxiliarySurface();
      return;
    }
    await this.openPanel({
      panelType,
      position: 'right',
      config: {},
    });
  }

   
  focusPanel(panelType: PanelType): void {
    const store = useAgentCanvasStore.getState();
    const matching = (['primary', 'secondary', 'tertiary'] as const)
      .map(groupId => {
        const group =
          groupId === 'primary'
            ? store.primaryGroup
            : groupId === 'secondary'
              ? store.secondaryGroup
              : store.tertiaryGroup;
        const tab = group.tabs.find(candidate => candidate.content.type === panelType);
        return tab ? { tab, groupId } : null;
      })
      .find(candidate => candidate !== null);
    if (!matching) return;
    store.switchToTab(matching.tab.id, matching.groupId);
    const hostKey = useAuxiliarySurfaceStore.getState().activeHostKey;
    if (hostKey) useAuxiliarySurfaceStore.getState().reveal(hostKey, 'explicit');
  }

   
  private buildTabDetail(
    panelType: PanelType,
    config: PanelConfig,
    options?: IdeControlOptions
  ): CanvasItemDescriptor {
    const duplicateCheckKey = this.getDuplicateCheckKey(panelType, config);
    const baseDetail = {
      type: panelType as PanelContentType,
      title: this.getPanelTitle(panelType, config),
      data: config.data || {},
      metadata: {
        duplicateCheckKey,
      },
      replaceExisting: options?.replace_existing ?? false,
      duplicateCheckKey, 
    };

    
    switch (panelType) {
      case 'git-diff':
        return {
          ...baseDetail,
          data: {
            ...baseDetail.data,
            filePath: config.file_path,
            diffType: config.diff_type || 'staged',
          },
        };

      case 'git-settings':
        return {
          ...baseDetail,
          title: i18nService.getT()('common:tabs.gitSettings'),
        };

      case 'planner':
        return {
          ...baseDetail,
          title: i18nService.getT()('common:tabs.taskPlanner'),
        };

      case 'generative-widget':
        return {
          ...baseDetail,
          title: config.title || 'Widget Preview',
          data: {
            ...baseDetail.data,
            widgetId: config.data?.widgetId,
            title: config.title || config.data?.title,
            widgetCode: config.data?.widgetCode,
            width: config.data?.width,
            height: config.data?.height,
            isSvg: config.data?.isSvg,
          },
        };

      case 'design-artifact':
        return {
          ...baseDetail,
          title: config.title || config.data?.manifest?.title || 'Design Canvas',
          data: {
            ...baseDetail.data,
            artifactId: config.data?.artifactId || config.data?.manifest?.id,
            manifest: config.data?.manifest,
            workspacePath: config.workspace_path || config.data?.workspacePath,
          },
        };

      case 'design-artifacts-browser':
        return {
          ...baseDetail,
          title: config.title || 'Designs',
          data: {
            ...baseDetail.data,
            workspacePath: config.workspace_path || config.data?.workspacePath,
          },
        };
      case 'design-tokens-studio':
        return {
          ...baseDetail,
          title: config.title || 'Design Tokens',
          data: {
            ...baseDetail.data,
            artifactId: config.data?.artifactId,
            scopePath: config.data?.scopePath,
            workspacePath: config.workspace_path || config.data?.workspacePath,
          },
        };
      case 'code-editor':
      case 'file-viewer':
      case 'markdown-editor':
      case 'plan-viewer':
        return {
          ...baseDetail,
          data: {
            ...baseDetail.data,
            filePath: config.file_path,
            workspacePath: config.workspace_path,
          },
        };

      default:
        return baseDetail;
    }
  }

   
  private getPanelTitle(panelType: PanelType, config: PanelConfig): string {
    const t = i18nService.getT();
    switch (panelType) {
      case 'git-settings':
        return t('common:tabs.gitSettings');
      case 'git-diff':
        return config.file_path ? `${t('common:tabs.gitDiff')}: ${config.file_path}` : t('common:tabs.gitDiff');
      case 'planner':
        return t('common:tabs.taskPlanner');
      case 'file-viewer':
        return t('common:tabs.fileBrowser');
      case 'code-editor':
        return config.file_path || t('common:tabs.editor');
      case 'markdown-editor':
        return config.file_path || t('common:tabs.markdown');
      case 'generative-widget':
        return config.title || 'Widget Preview';
      case 'design-artifact':
        return (
          config.title ||
          config.data?.manifest?.title ||
          (config.data?.artifactId ? `Design · ${config.data.artifactId}` : 'Design Canvas')
        );
      case 'design-artifacts-browser':
        return config.title || 'Designs';
      case 'design-tokens-studio':
        return config.title || 'Design Tokens';
      default:
        return panelType;
    }
  }

   
  private getDuplicateCheckKey(panelType: PanelType, config: PanelConfig): string {
    switch (panelType) {
      case 'git-diff':
        return config.file_path ? `git-diff-${config.file_path}` : 'git-diff';
      case 'code-editor':
      case 'markdown-editor':
        return config.file_path ? config.file_path : `${panelType}-${Date.now()}`;
      case 'planner':
      case 'git-settings':
        
        return panelType;
      case 'design-artifact':
        return config.data?.artifactId
          ? `design-artifact-${config.data.artifactId}`
          : `design-artifact-${Date.now()}`;
      case 'design-artifacts-browser':
        return 'design-artifacts-browser';
      case 'design-tokens-studio':
        return config.data?.artifactId
          ? `design-tokens-studio-${config.data.artifactId}`
          : 'design-tokens-studio';
      default:
        return `${panelType}-${Date.now()}`;
    }
  }

   
   
  private sendExecutionResult(requestId: string, success: boolean, message: string): void {
    
    import('@tauri-apps/api/core').then(({ invoke }) => {
      invoke('report_ide_control_result', {
        request_id: requestId,
        success,
        message: success ? message : undefined,
        error: success ? undefined : message,
        timestamp: Date.now(),
      }).catch((error) => {
        log.error('Failed to send execution result', error);
      });
    });
  }
}
