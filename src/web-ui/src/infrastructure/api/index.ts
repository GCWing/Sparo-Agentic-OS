/**
 * Sparo OS API unified exports.
 *
 * Follows the Sparo OS Tauri command conventions.
 */

export * from './service-api/types';
export * from './service-api/ApiClient';
export * from './service-api/tauri-commands';
export * from './service-api/AIApi';
export * from './service-api/CronAPI';
export * from './service-api/SystemFsAPI';
export * from './service-api/TokenUsageAPI';
export * from './service-api/StorageAPI';
export * from './service-api/GoalAPI';
export * from './service-api/MarkdownExportAPI';
export * from './service-api/ProductAppRuntimeAPI';
export * from './service-api/ProductAppRuntimeHostAPI';

// Import API modules
import { workspaceAPI } from './service-api/WorkspaceAPI';
import { systemFsAPI, pinnedAPI, filesContextAPI, fileWorkbenchAPI } from './service-api/SystemFsAPI';
import { configAPI } from './service-api/ConfigAPI';
import { aiApi } from './service-api/AIApi';
import { toolAPI } from './service-api/ToolAPI';
import { agentAPI } from './service-api/AgentAPI';
import { systemAPI } from './service-api/SystemAPI';
import { projectAPI } from './service-api/ProjectAPI';
import { diffAPI } from './service-api/DiffAPI';
import { snapshotAPI } from './service-api/SnapshotAPI';
import { globalAPI } from './service-api/GlobalAPI';
import { contextAPI } from './service-api/ContextAPI';
import { cronAPI } from './service-api/CronAPI';
import { sessionAPI } from './service-api/SessionAPI';
import { i18nAPI } from './service-api/I18nAPI';
import { btwAPI } from './service-api/BtwAPI';
import { markdownAiAPI } from './service-api/MarkdownAiAPI';
import { markdownExportAPI } from './service-api/MarkdownExportAPI';
import { tokenUsageAPI } from './service-api/TokenUsageAPI';
import { storageAPI } from './service-api/StorageAPI';
import { goalAPI } from './service-api/GoalAPI';
import { productAppRuntimeAPI } from './service-api/ProductAppRuntimeAPI';
import { productAppRuntimeHostAPI } from './service-api/ProductAppRuntimeHostAPI';

// Export API modules
export { workspaceAPI, systemFsAPI, pinnedAPI, filesContextAPI, fileWorkbenchAPI, configAPI, aiApi, toolAPI, agentAPI, systemAPI, projectAPI, diffAPI, snapshotAPI, globalAPI, contextAPI, cronAPI, sessionAPI, i18nAPI, btwAPI, markdownAiAPI, markdownExportAPI, tokenUsageAPI, storageAPI, goalAPI, productAppRuntimeAPI, productAppRuntimeHostAPI };

// Sparo OS API collection: a single access point for all API modules.
export const sparoAPI = {
  workspace: workspaceAPI,
  systemFs: systemFsAPI,
  pinned: pinnedAPI,
  filesContext: filesContextAPI,
  fileWorkbench: fileWorkbenchAPI,
  config: configAPI,
  ai: aiApi,
  tool: toolAPI,
  agent: agentAPI,
  system: systemAPI,
  project: projectAPI,
  diff: diffAPI,
  snapshot: snapshotAPI,
  global: globalAPI,
  context: contextAPI,
  cron: cronAPI,
  session: sessionAPI,
  i18n: i18nAPI,
  btw: btwAPI,
  markdownAi: markdownAiAPI,
  markdownExport: markdownExportAPI,
  tokenUsage: tokenUsageAPI,
  storage: storageAPI,
  goal: goalAPI,
  productAppRuntime: productAppRuntimeAPI,
  productAppRuntimeHost: productAppRuntimeHostAPI,
};

// Default export
export default sparoAPI;
