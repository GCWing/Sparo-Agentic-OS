 


export const APP_INFO = {
  name: 'Sparo OS',
  version: '1.0.0',
  description: 'Agentic OS desktop application for building and running intelligent apps',
  author: 'Sparo OS',
  homepage: 'https://github.com/GCWing/Sparo-Agentic-OS'
} as const;


export const STORAGE_KEYS = {
  THEME: 'sparo-theme',
  LANGUAGE: 'sparo-language',
  LEFT_PANEL_WIDTH: 'sparo-left-panel-width',
  LEFT_PANEL_COLLAPSED: 'sparo-left-panel-collapsed',
  RECENT_WORKSPACES: 'sparo-recent-workspaces',
  USER_PREFERENCES: 'sparo-user-preferences',
  CHAT_HISTORY: 'sparo-chat-history',
  DIFF_CLOSE_WARNING_DISABLED: 'sparo-diff-close-warning-disabled',
  MANUAL_TERMINAL_PROFILES: 'sparo-manual-terminal-profiles'
} as const;


export const PANEL_CONFIG = {
  MIN_WIDTH: 100,
  DEFAULT_WIDTH: 400,
  RESIZE_DEBOUNCE: 100,
  
  DEFAULT_LEFT_PANEL_RATIO: 0.3,
} as const;


export const calculateDefaultPanelWidth = (windowWidth: number = window.innerWidth): number => {
  return Math.max(PANEL_CONFIG.MIN_WIDTH, Math.floor(windowWidth * PANEL_CONFIG.DEFAULT_LEFT_PANEL_RATIO));
};


// export const THEMES = {
//   LIGHT: 'light',
//   DARK: 'dark',
//   AUTO: 'auto'
// } as const;


export const SUPPORTED_FILE_TYPES = {
  CODE: [
    'js', 'jsx', 'ts', 'tsx', 'vue', 'py', 'java', 'cpp', 'c', 'cs', 'php',
    'rb', 'go', 'rs', 'kt', 'swift', 'dart', 'scala', 'clj', 'hs', 'elm'
  ],
  CONFIG: [
    'json', 'yml', 'yaml', 'toml', 'ini', 'conf', 'config', 'env'
  ],
  MARKUP: [
    'html', 'xml', 'md', 'mdx', 'tex', 'rst'
  ],
  STYLE: [
    'css', 'scss', 'sass', 'less', 'stylus'
  ],
  DATA: [
    'sql', 'graphql', 'proto'
  ]
} as const;


export const API_CONFIG = {
  TIMEOUT: 30000,
  RETRY_ATTEMPTS: 0,
  RETRY_DELAY: 1000
} as const;


export const MESSAGE_TYPES = {
  SUCCESS: 'success',
  WARNING: 'warning',
  ERROR: 'error',
  INFO: 'info'
} as const;


export const ANALYSIS_TYPES = {
  FUNCTION: 'function',
  LOGIC: 'logic',
  DATA: 'data',
  ARCHITECTURE: 'architecture',
  COMPONENT: 'component',
  FLOW: 'flow'
} as const;


export const MODEL_PROVIDERS = {
  OPENAI: 'openai',
  ANTHROPIC: 'anthropic',
  GEMINI: 'gemini',
  LOCAL: 'local'
} as const;


export const DEFAULT_CONFIG = {
  THEME: 'auto', 
  LANGUAGE: 'zh-CN',
  AUTO_SAVE: true,
  AUTO_ANALYZE: false,
  SHOW_LINE_NUMBERS: true,
  ENABLE_MINIMAP: true
} as const;


export const PERFORMANCE_CONFIG = {
  DEBOUNCE_DELAY: 300,
  THROTTLE_DELAY: 100,
  CHUNK_SIZE: 100,
  MAX_FILE_SIZE: 10 * 1024 * 1024, // 10MB
  MAX_HISTORY_SIZE: 100
} as const;


export const SHORTCUTS = {
  TOGGLE_THEME: 'Ctrl+Shift+T',
  TOGGLE_SIDEBAR: 'Ctrl+B',
  SEARCH: 'Ctrl+F',
  NEW_CHAT: 'Ctrl+N',
  SAVE: 'Ctrl+S',
  EXPORT: 'Ctrl+E'
} as const;


export const VALIDATION_RULES = {
  MIN_PASSWORD_LENGTH: 8,
  MAX_FILE_NAME_LENGTH: 255,
  MAX_DESCRIPTION_LENGTH: 500,
  MAX_CHAT_MESSAGE_LENGTH: 10000
} as const;

