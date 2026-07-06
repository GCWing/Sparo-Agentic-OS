/**
 * settingsConfig — static shape of settings categories and tabs.
 *
 * Shared by SettingsNav (left sidebar) and SettingsScene (content renderer).
 * Labels are i18n keys resolved at render time via useTranslation('settings').
 */

export type ConfigTab =
  | 'appearance'
  | 'basics'
  | 'models'
  | 'aiUsage'
  | 'dataStorage'
  | 'personalization'
  | 'bitfunCoder'
  | 'permissions'
  | 'memory'
  // | 'lsp' // temporarily hidden from config center
  | 'editor'
  | 'keyboard';

export interface ConfigTabDef {
  id: ConfigTab;
  labelKey: string;
  /** i18n key under settings namespace for tab description (search + discoverability). */
  descriptionKey?: string;
  /** Language-neutral extra tokens matched by search (ASCII recommended). */
  keywords?: string[];
  /** Show a Beta pill next to the tab label in the settings nav. */
  beta?: boolean;
}

export interface ConfigCategoryDef {
  id: string;
  nameKey: string;
  tabs: ConfigTabDef[];
}

export const SETTINGS_CATEGORIES: ConfigCategoryDef[] = [
  {
    id: 'general',
    nameKey: 'categories.general',
    tabs: [
      {
        id: 'basics',
        labelKey: 'tabs.basics',
        descriptionKey: 'tabDescriptions.basics',
        keywords: [
          'logging',
          'log',
          'terminal',
          'shell',
          'pwsh',
          'powershell',
          'autostart',
          'login',
          'boot',
          'launch',
        ],
      },
      {
        id: 'appearance',
        labelKey: 'tabs.appearance',
        descriptionKey: 'tabDescriptions.appearance',
        keywords: [
          'language',
          'locale',
          'i18n',
          'theme',
          'appearance',
          'font',
          'font size',
          'ui font',
          'chat font',
        ],
      },
      {
        id: 'models',
        labelKey: 'tabs.models',
        descriptionKey: 'tabDescriptions.models',
        keywords: [
          'api',
          'api key',
          'provider',
          'openai',
          'claude',
          'gpt',
          'base url',
          'proxy',
          'model',
          'temperature',
          'token',
        ],
      },
      {
        id: 'keyboard',
        labelKey: 'tabs.keyboard',
        descriptionKey: 'tabDescriptions.keyboard',
        keywords: [
          'keyboard',
          'shortcut',
          'keybinding',
          'hotkey',
          'shortcut key',
          '快捷键',
          '键位',
        ],
      },
    ],
  },
  {
    id: 'smartCapabilities',
    nameKey: 'categories.smartCapabilities',
    tabs: [
      {
        id: 'personalization',
        labelKey: 'tabs.personalization',
        descriptionKey: 'tabDescriptions.personalization',
        keywords: [
          'session',
          'chat',
          'personalization',
          'title',
          'agent companion',
          'personality',
          '个性化',
          '标题',
          '伙伴',
        ],
      },
      {
        id: 'permissions',
        labelKey: 'tabs.permissions',
        descriptionKey: 'tabDescriptions.permissions',
        keywords: [
          'tool',
          'permission',
          'permissions',
          'streaming',
          'timeout',
          'confirmation',
          'computer use',
          'screen capture',
          'accessibility',
          'agent',
          '权限',
          '授权',
        ],
      },
      {
        id: 'memory',
        labelKey: 'tabs.memory',
        descriptionKey: 'tabDescriptions.memory',
        keywords: [
          'memory',
          'auto memory',
          'auto-memory',
          'extract memory',
          'eligible turn',
          'extract every',
          '记忆',
          '自动记忆',
          '提炼记忆',
        ],
      },
    ],
  },
  {
    id: 'productApps',
    nameKey: 'categories.productApps',
    tabs: [
      {
        id: 'bitfunCoder',
        labelKey: 'tabs.bitfunCoder',
        descriptionKey: 'tabDescriptions.bitfunCoder',
        keywords: [
          'bitfun coder',
          'product app',
          'coding',
          'debug',
          'debug mode',
          'debug config',
          'ingest',
          'log path',
          'language template',
          'instrumentation',
          'BitFun Coder',
          '调试',
          '日志',
          '语言模板',
        ],
      },
      {
        id: 'editor',
        labelKey: 'tabs.editor',
        descriptionKey: 'tabDescriptions.editor',
        keywords: [
          'font',
          'indent',
          'tab',
          'minimap',
          'word wrap',
          'line number',
          'format',
          'save',
        ],
      },
      // LSP / language server settings — temporarily hidden from nav
      // {
      //   id: 'lsp',
      //   labelKey: 'configCenter.tabs.lsp',
      //   descriptionKey: 'configCenter.tabDescriptions.lsp',
      //   keywords: ['lsp', 'language server', 'typescript', 'intellisense'],
      // },
    ],
  },
  {
    id: 'data',
    nameKey: 'categories.data',
    tabs: [
      {
        id: 'aiUsage',
        labelKey: 'tabs.aiUsage',
        descriptionKey: 'tabDescriptions.aiUsage',
        keywords: [
          'ai usage',
          'usage',
          'tokens',
          'token history',
          'cost',
          'model usage',
          'agent usage',
          'analytics',
        ],
      },
      {
        id: 'dataStorage',
        labelKey: 'tabs.dataStorage',
        descriptionKey: 'tabDescriptions.dataStorage',
        keywords: [
          'storage',
          'data',
          'reset',
          'factory reset',
          'cleanup',
          'cache',
          'logs',
          'sessions',
          'memory',
          'workspace runtime',
        ],
      },
    ],
  },
];

export const DEFAULT_SETTINGS_TAB: ConfigTab = 'basics';

const KNOWN_TABS: ConfigTab[] = SETTINGS_CATEGORIES.flatMap((c) => c.tabs.map((t) => t.id));

/** Map removed or renamed tabs; used by deep links and IDE actions. */
export function normalizeSettingsTab(section: string): ConfigTab {
  if (section === 'theme' || section === 'appearance' || section === 'language' || section === 'font') return 'appearance';
  if (section === 'logging' || section === 'terminal') return 'basics';
  if (section === 'ai-usage' || section === 'usage' || section === 'token-usage') return 'aiUsage';
  if (section === 'data-storage' || section === 'storage' || section === 'reset' || section === 'cleanup') return 'dataStorage';
  if (section === 'session-config' || section === 'personal' || section === 'companion') return 'personalization';
  if (section === 'bitfun-coder' || section === 'debug-mode') return 'bitfunCoder';
  if (section === 'permission' || section === 'permissions' || section === 'computer-use' || section === 'tool-execution') return 'permissions';
  if (section === 'memory' || section === 'auto-memory' || section === 'auto_memory' || section === 'extract-memory') return 'memory';
  if (section === 'ai-context') return DEFAULT_SETTINGS_TAB;
  if (section === 'lsp') return DEFAULT_SETTINGS_TAB;
  if (section === 'shortcuts' || section === 'keybindings' || section === 'hotkeys') return 'keyboard';
  if ((KNOWN_TABS as readonly string[]).includes(section)) return section as ConfigTab;
  return DEFAULT_SETTINGS_TAB;
}
