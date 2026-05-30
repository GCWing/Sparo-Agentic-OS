/**
 * i18n keys for in-page section titles/descriptions (and related copy) per settings tab.
 * Used by SettingsNav search so queries match content inside each config page.
 *
 * Keep in sync when adding ConfigPageSection / page headers on these tabs.
 */

import type { ConfigTab } from './settingsConfig';

export interface SettingsTabSearchPhrase {
  ns: string;
  key: string;
}

/** Phrases resolved at runtime with i18n.getFixedT(lang, ns)(key). */
export const SETTINGS_TAB_SEARCH_CONTENT: Record<ConfigTab, readonly SettingsTabSearchPhrase[]> = {
  appearance: [
    { ns: 'settings/appearance', key: 'title' },
    { ns: 'settings/appearance', key: 'subtitle' },
    { ns: 'settings/appearance', key: 'appearance.title' },
    { ns: 'settings/appearance', key: 'appearance.hint' },
    { ns: 'settings/appearance', key: 'appearance.language' },
    { ns: 'settings/appearance', key: 'appearance.themes' },
    { ns: 'settings/appearance', key: 'appearance.fontSize.title' },
    { ns: 'settings/appearance', key: 'appearance.fontSize.hint' },
  ],
  basics: [
    { ns: 'settings/basics', key: 'title' },
    { ns: 'settings/basics', key: 'subtitle' },
    { ns: 'settings/basics', key: 'logging.sections.logging' },
    { ns: 'settings/basics', key: 'logging.sections.loggingHint' },
    { ns: 'settings/basics', key: 'terminal.sections.terminal' },
    { ns: 'settings/basics', key: 'terminal.sections.terminalHint' },
  ],

  models: [
    { ns: 'settings/ai-model', key: 'title' },
    { ns: 'settings/ai-model', key: 'subtitle' },
    { ns: 'settings/default-model', key: 'tabs.default' },
    { ns: 'settings/default-model', key: 'subtitle' },
    { ns: 'settings/default-model', key: 'tabs.models' },
    { ns: 'settings/ai-model', key: 'subtitle' },
    { ns: 'settings/default-model', key: 'tabs.proxy' },
    { ns: 'settings/ai-model', key: 'proxy.enableHint' },
  ],

  aiUsage: [
    { ns: 'settings/ai-usage', key: 'title' },
    { ns: 'settings/ai-usage', key: 'sections.overview' },
    { ns: 'settings/ai-usage', key: 'sections.trend' },
    { ns: 'settings/ai-usage', key: 'sections.filters' },
    { ns: 'settings/ai-usage', key: 'filters.groupBy.agent' },
    { ns: 'settings/ai-usage', key: 'filters.groupBy.model' },
    { ns: 'settings/ai-usage', key: 'filters.groupBy.time' },
    { ns: 'settings/ai-usage', key: 'sections.recent' },
  ],

  dataStorage: [
    { ns: 'settings/data-storage', key: 'title' },
    { ns: 'settings/data-storage', key: 'sections.usage' },
    { ns: 'settings/data-storage', key: 'sections.reset' },
    { ns: 'settings/data-storage', key: 'reset.mode.soft' },
    { ns: 'settings/data-storage', key: 'reset.mode.appData' },
    { ns: 'settings/data-storage', key: 'reset.mode.factory' },
    { ns: 'settings/data-storage', key: 'reset.summary.soft' },
    { ns: 'settings/data-storage', key: 'reset.summary.appData' },
    { ns: 'settings/data-storage', key: 'reset.summary.factory' },
    { ns: 'settings/data-storage', key: 'reset.options.backup.label' },
    { ns: 'settings/data-storage', key: 'reset.options.secrets.label' },
    { ns: 'settings/data-storage', key: 'reset.options.browser.label' },
  ],

  personalization: [
    { ns: 'settings/personalization', key: 'title' },
    { ns: 'settings/personalization', key: 'subtitle' },
    { ns: 'settings/personalization', key: 'features.sessionTitle.title' },
    { ns: 'settings/personalization', key: 'features.sessionTitle.subtitle' },
    { ns: 'settings/personalization', key: 'features.agentCompanion.title' },
    { ns: 'settings/personalization', key: 'features.agentCompanion.subtitle' },
    { ns: 'settings/debug', key: 'sections.combined' },
    { ns: 'settings/debug', key: 'sections.combinedDescription' },
    { ns: 'settings/debug', key: 'settings.logPath.label' },
    { ns: 'settings/debug', key: 'settings.logPath.description' },
    { ns: 'settings/debug', key: 'settings.ingestPort.label' },
    { ns: 'settings/debug', key: 'settings.ingestPort.description' },
    { ns: 'settings/debug', key: 'sections.templates' },
    { ns: 'settings/debug', key: 'templates.description' },
  ],
  permissions: [
    { ns: 'settings/permissions', key: 'title' },
    { ns: 'settings/permissions', key: 'subtitle' },
    { ns: 'settings/permissions', key: 'toolExecution.sectionTitle' },
    { ns: 'settings/permissions', key: 'toolExecution.sectionDescription' },
    { ns: 'settings/permissions', key: 'computerUse.sectionTitle' },
    { ns: 'settings/permissions', key: 'computerUse.sectionDescription' },
    { ns: 'settings/permissions', key: 'computerUse.enable' },
    { ns: 'settings/permissions', key: 'computerUse.enableDesc' },
    { ns: 'settings/agentic-tools', key: 'config.autoExecute' },
    { ns: 'settings/agentic-tools', key: 'config.autoExecuteDesc' },
    { ns: 'settings/agentic-tools', key: 'config.confirmTimeout' },
    { ns: 'settings/agentic-tools', key: 'config.confirmTimeoutDesc' },
    { ns: 'settings/agentic-tools', key: 'config.executionTimeout' },
    { ns: 'settings/agentic-tools', key: 'config.executionTimeoutDesc' },
  ],
  memory: [
    { ns: 'settings/memory', key: 'title' },
    { ns: 'settings/memory', key: 'subtitle' },
    { ns: 'settings/memory', key: 'autoMemory.global.sectionTitle' },
    { ns: 'settings/memory', key: 'autoMemory.global.sectionDescription' },
    { ns: 'settings/memory', key: 'autoMemory.global.enabled' },
    { ns: 'settings/memory', key: 'autoMemory.global.enabledDesc' },
    { ns: 'settings/memory', key: 'autoMemory.global.extractEveryEligibleTurns' },
    { ns: 'settings/memory', key: 'autoMemory.global.extractEveryEligibleTurnsDesc' },
    { ns: 'settings/memory', key: 'autoMemory.workspace.sectionTitle' },
    { ns: 'settings/memory', key: 'autoMemory.workspace.sectionDescription' },
    { ns: 'settings/memory', key: 'autoMemory.workspace.enabled' },
    { ns: 'settings/memory', key: 'autoMemory.workspace.enabledDesc' },
    { ns: 'settings/memory', key: 'autoMemory.workspace.extractEveryEligibleTurns' },
    { ns: 'settings/memory', key: 'autoMemory.workspace.extractEveryEligibleTurnsDesc' },
    { ns: 'settings/memory', key: 'hostScan.title' },
    { ns: 'settings/memory', key: 'hostScan.hint' },
    { ns: 'settings/memory', key: 'hostScan.enable.label' },
    { ns: 'settings/memory', key: 'hostScan.enable.description' },
    { ns: 'settings/memory', key: 'hostScan.interval.label' },
    { ns: 'settings/memory', key: 'hostScan.interval.description' },
  ],
  editor: [
    { ns: 'settings/editor', key: 'title' },
    { ns: 'settings/editor', key: 'subtitle' },
    { ns: 'settings/editor', key: 'sections.appearance.title' },
    { ns: 'settings/editor', key: 'sections.appearance.description' },
    { ns: 'settings/editor', key: 'sections.behavior.title' },
    { ns: 'settings/editor', key: 'sections.behavior.description' },
    { ns: 'settings/editor', key: 'sections.display.title' },
    { ns: 'settings/editor', key: 'sections.display.description' },
    { ns: 'settings/editor', key: 'sections.advanced.title' },
    { ns: 'settings/editor', key: 'sections.advanced.description' },
    { ns: 'settings/editor', key: 'actions.save' },
    { ns: 'settings/editor', key: 'actions.saveDesc' },
  ],

  keyboard: [
    { ns: 'settings', key: 'keyboard.title' },
    { ns: 'settings', key: 'keyboard.description' },
    { ns: 'settings', key: 'keyboard.scopes.app' },
    { ns: 'settings', key: 'keyboard.scopes.chat' },
    { ns: 'settings', key: 'keyboard.scopes.filetree' },
    { ns: 'settings', key: 'keyboard.scopes.canvas' },
    { ns: 'settings', key: 'keyboard.shortcuts.tab.close' },
    { ns: 'settings', key: 'keyboard.shortcuts.tab.switchMerged' },
    { ns: 'settings', key: 'keyboard.shortcuts.tab.switchMergedHint' },
  ],

  // lsp: [ ... ], // nav entry temporarily hidden; omit from search index
};
