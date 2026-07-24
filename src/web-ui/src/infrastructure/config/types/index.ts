import { i18nService } from '@/infrastructure/i18n';

const t = (key: string, options?: Record<string, unknown>) => i18nService.t(key, options);
export interface GlobalConfig {
  app: AppConfig;
  editor: EditorConfig;
  terminal: TerminalConfig;
  ai: AIConfig;
  product_apps: ProductAppsConfig;
  version: string;
  last_modified: number;
}

export interface AppConfig {
  language: string;
  logging: AppLoggingConfig;
  notifications: NotificationConfig;
  host_scan: AppHostScanConfig;
  ai_experience: AIExperienceConfig;
}

export type BackendLogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'off';

export interface AppLoggingConfig {
  level: BackendLogLevel;
}

export interface AppHostScanConfig {
  auto_scan_enabled: boolean;
  auto_scan_interval_days: number;
}

export interface NotificationConfig {
  /** Whether to show a toast when a dialog turn completes while the window is not focused. */
  dialog_completion_notify: boolean;
  /** Whether to show built-in tip cards on each startup. Defaults to true. */
  enable_startup_tips: boolean;
}

export interface AIExperienceConfig {
  /** Whether Daily Letter generation is enabled. */
  enable_daily_letter: boolean;

  enable_session_title_generation: boolean;

  /** Whether to enable visual mode (use Mermaid diagrams to illustrate complex logic and flows). */
  enable_visual_mode: boolean;

  /** Whether to show the pixel Agent companion in the collapsed chat input. */
  enable_agent_companion: boolean;

  /** Optional Petdex-compatible companion package selected by the user. */
  agent_companion_pet?: AgentCompanionPetSelection | null;

  /** Whether to show model thinking process in FlowChat. */
  show_thinking_process: boolean;

  /** Whether completed thinking blocks remain as expandable collapsed items. */
  show_completed_thinking_item: boolean;

  /** Local voice input settings for the composer. */
  voice_input: VoiceInputSettings;
}

export interface VoiceInputSettings {
  enabled: boolean;
  default_language: string;
  max_recording_seconds: number;
}

export interface AgentCompanionPetSelection {
  id: string;
  displayName: string;
  description?: string | null;
  source: 'preset' | 'user';
  packagePath: string;
  spritesheetPath: string;
  spritesheetMimeType: string;
}

export type ModelCapability =
  | 'text_chat'
  | 'function_calling'
  | 'image_understanding'
  | 'image_generation'
  | 'embedding'
  | 'search'
  | 'code_specialized'
  | 'speech_recognition';

export type ModelCategory =
  | 'general_chat'
  | 'multimodal'
  | 'image_generation'
  | 'embedding'
  | 'search_enhanced'
  | 'code_specialized'
  | 'speech_recognition';

export type ReasoningMode =
  | 'default'
  | 'enabled'
  | 'disabled'
  | 'adaptive';

export interface ModelMetadata {
  category: ModelCategory;
  capabilities: ModelCapability[];
  recommendedFor?: string[];
  strengths?: string[];
}

export const CATEGORY_LABELS: Record<ModelCategory, string> = {
  general_chat: t('settings/ai-model:category.general_chat'),
  multimodal: t('settings/ai-model:category.multimodal'),
  image_generation: t('settings/ai-model:category.image_generation'),
  embedding: t('settings/ai-model:category.embedding'),
  search_enhanced: t('settings/ai-model:category.search_enhanced'),
  code_specialized: t('settings/ai-model:category.code_specialized'),
  speech_recognition: t('settings/ai-model:category.speech_recognition')
};

export const CATEGORY_ICONS: Record<ModelCategory, string> = {
  general_chat: t('settings/ai-model:categoryIcons.general_chat'),
  multimodal: t('settings/ai-model:categoryIcons.multimodal'),
  image_generation: t('settings/ai-model:categoryIcons.image_generation'),
  embedding: t('settings/ai-model:categoryIcons.embedding'),
  search_enhanced: t('settings/ai-model:categoryIcons.search_enhanced'),
  code_specialized: t('settings/ai-model:categoryIcons.code_specialized'),
  speech_recognition: t('settings/ai-model:categoryIcons.speech_recognition')
};

export type CustomHeadersMode = 'replace' | 'merge';
export type CustomRequestBodyMode = 'merge' | 'trim';

export interface AIModelConfig {
  id?: string;
  name: string;
  provider: string;
  api_key?: string;
  /** Derived from a redacted snapshot; never persisted as config data. */
  api_key_configured?: boolean;
  base_url: string;
  /** Computed actual request URL, derived from base_url + provider format. Stored on save. */
  request_url?: string;
  model_name: string;
  context_window: number;
  max_tokens?: number;
  temperature?: number;
  top_p?: number;
  enabled: boolean;
  is_default?: boolean;
  custom_headers?: Record<string, string>;
  custom_headers_mode?: CustomHeadersMode;
  skip_ssl_verify?: boolean;
  custom_request_body?: string;
  custom_request_body_mode?: CustomRequestBodyMode;
  timeout?: number;
  category: ModelCategory;
  capabilities: ModelCapability[];
  recommended_for?: string[];
  metadata?: Record<string, any>;
  reasoning_mode: ReasoningMode;
  /** Parse `<think>...</think>` text chunks into streaming reasoning content. */
  inline_think_in_text?: boolean;
  /** Provider-specific reasoning effort. */
  reasoning_effort?: string;
  /** Optional Anthropic manual thinking token budget. */
  thinking_budget_tokens?: number;
  /** Authentication source. Defaults to inline `api_key`. */
  auth?: AuthConfig;
}

/** Authentication source persisted on each model entry. */
export type AuthConfig =
  | { type: 'api_key' }
  | { type: 'codex_cli' }
  | { type: 'gemini_cli' };

export interface ProxyConfig {
  enabled: boolean;
  url: string;
  username?: string;
  password?: string;
}

export interface DefaultModelsConfig {
  primary?: string | null;
  fast?: string | null;
  search?: string | null;
  image_understanding?: string | null;
  image_generation?: string | null;
  speech_recognition?: string | null;
}

export interface AIConfig {
  models: AIModelConfig[];
  default_models: DefaultModelsConfig;
  agent_models: Record<string, string>;
  func_agent_models: Record<string, string>;
  agent_capability_configs: Record<string, StoredAgentCapabilityConfigItem>;
  subagent_configs: Record<string, SubAgentConfigItem>;
  proxy: ProxyConfig;
  request_timeout: number;
  max_retries: number;
  temperature: number;
  max_tokens: number;
  streaming: boolean;
  auto_save_conversations: boolean;
  conversation_history_limit: number;
  stream_idle_timeout_secs?: number | null;
  tool_execution_timeout_secs?: number | null;
  tool_confirmation_timeout_secs?: number | null;
  skip_tool_confirmation?: boolean;
  auto_memory?: AutoMemoryConfig;
  goal_mode?: GoalModeConfig;
  computer_use_enabled?: boolean;
}

export interface GoalModeConfig {
  max_continuation_turns: number;
}

export interface AutoMemoryConfig {
  global: AutoMemoryScopeConfig;
  workspace: AutoMemoryScopeConfig;
}

export interface AutoMemoryScopeConfig {
  enabled: boolean;
  extract_every_eligible_turns: number;
  min_extract_interval_secs: number;
  force_extract_after_pending_eligible_turns?: number | null;
}

export interface ProductAppsConfig {
  apps: Record<string, ProductAppConfig>;
}

export interface ProductAppConfig {
  debug?: DebugModeConfig | null;
  [key: string]: unknown;
}

export interface StoredAgentCapabilityConfigItem {
  agent_id: string;
  added_tools: string[];
  removed_tools: string[];
  enabled: boolean;
  disabled_user_skills?: string[];
  enabled_user_skills?: string[];
  disabled_user_skill_suites?: string[];
  enabled_user_skill_suites?: string[];
  disabled_subagents?: string[];
  enabled_subagents?: string[];
}

export interface AgentCapabilitySelection {
  defaults: string[];
  added: string[];
  removed: string[];
  effective: string[];
}

export interface SubAgentConfigItem {
  enabled: boolean;
}

export type SkillLevel = 'user' | 'project';
export type SkillGovernance = 'sparoManaged' | 'userManaged' | 'projectManaged';
export type SkillSuiteMemberOverridePolicy = 'sparoManaged' | 'suiteLocal' | 'workspaceMayOverride';

export interface SkillSuiteMemberRef {
  skillId: string;
  role?: string | null;
  required: boolean;
  overridePolicy: SkillSuiteMemberOverridePolicy;
}

export interface SkillSuiteInfo {
  key: string;
  id: string;
  name: string;
  description: string;
  level: SkillLevel;
  sourceSlot: string;
  path: string;
  governance: SkillGovernance;
  routerPath?: string | null;
  memberSkillKeys: string[];
  missingRefs: SkillSuiteMemberRef[];
  tags: string[];
  isBuiltin: boolean;
  canDelete: boolean;
  canEdit: boolean;
  canUpdate: boolean;
}

export interface SkillCatalog {
  skills: SkillInfo[];
  suites: SkillSuiteInfo[];
}

export interface SkillInfo {
  key: string;
  name: string;
  description: string;
  path: string;
  level: SkillLevel;
  sourceSlot: string;
  dirName: string;
  isBuiltin: boolean;
  governance: SkillGovernance;
  suiteKey?: string | null;
  suiteMemberOverridePolicy?: SkillSuiteMemberOverridePolicy | null;
  tags: string[];
  canDelete: boolean;
  canEdit: boolean;
  canUpdate: boolean;
}

export interface AgentSkillInfo extends SkillInfo {
  /** True when this skill key is explicitly disabled in the current mode config. */
  disabledByAgent: boolean;
  /** True when this skill is the one actually selected at runtime after disable + priority resolution. */
  selectedForRuntime: boolean;
}

export interface SkillMarketItem {
  id: string;
  name: string;
  description: string;
  source: string;
  installs: number;
  url: string;
  installId: string;
}

export interface SkillMarketDownloadResult {
  package: string;
  level: SkillLevel;
  installedSkills: string[];
  output: string;
}

export interface DebugModeConfig {
  log_path: string;
  ingest_port: number;
  enabled_languages: string[];
  language_templates: Record<string, LanguageDebugTemplate>;
}


export interface LanguageDebugTemplate {
  language: string;
  display_name: string;
  enabled: boolean;
  instrumentation_template: string;
  region_start: string;
  region_end: string;
  notes: string[];
}

export const LANGUAGE_TEMPLATE_LABELS: Record<string, string> = {
  javascript: t('settings/debug:languageLabels.javascript'),
  python: t('settings/debug:languageLabels.python'),
  rust: t('settings/debug:languageLabels.rust'),
  go: t('settings/debug:languageLabels.go'),
  java: t('settings/debug:languageLabels.java')
};

export const ALL_LANGUAGES = ['javascript', 'python', 'rust', 'go', 'java'] as const;

export type SkillPackageKind = 'skill' | 'suite';

export interface SkillPackageValidationResult {
  valid: boolean;
  kind?: SkillPackageKind;
  name?: string;
  description?: string;
  memberCount?: number;
  error?: string;
}

export interface EditorConfig {
  font_size: number;
  font_family: string;
  font_weight?: 'normal' | 'bold';
  line_height: number;
  tab_size: number;
  insert_spaces: boolean;
  word_wrap: string;
  line_numbers: string;
  minimap: MinimapConfig;
  theme: string;
  auto_save: string;
  auto_save_delay: number;
  format_on_save: boolean;
  format_on_paste: boolean;
  trim_auto_whitespace: boolean;
  cursor_style?: string;
  cursor_blinking?: string;
  render_whitespace?: string;
  render_line_highlight?: string;
  smooth_scrolling?: boolean;
  scroll_beyond_last_line?: boolean;
  semantic_highlighting?: boolean;
  bracket_pair_colorization?: boolean;
}

export interface MinimapConfig {
  enabled: boolean;
  side?: string;
  size?: string;
}

export interface TerminalConfig {
  default_shell: string;
  font_size: number;
  font_family: string;
  cursor_style: string;
  cursor_blink: boolean;
  scrollback_lines: number;
  theme: string;
  transparency: number;
  bell_style: string;
  copy_on_select: boolean;
  paste_on_right_click: boolean;
  confirm_on_exit: boolean;
  startup_command: string;
  env_vars: Record<string, string>;
}

export interface IConfigManager {
  getSetting<T = any>(settingId: string): Promise<T>;
  setSetting<T = any>(
    settingId: string,
    value: T,
    options?: ConfigManagerWriteOptions,
  ): Promise<void>;
  updateSetting<TCurrent = any, TNext = TCurrent>(
    settingId: string,
    updater: (current: TCurrent | undefined) => TNext,
    options?: ConfigManagerWriteOptions,
  ): Promise<void>;
  resetSetting(settingId: string, options?: ConfigManagerWriteOptions): Promise<void>;
  watch(settingId: string, callback: () => void): () => void;
  onSettingChange(
    callback: (settingId: string, oldValue: any, newValue: any) => void,
  ): () => void;
}

export interface ConfigManagerWriteOptions {
  confirmed?: boolean;
}

export interface RuntimeLoggingInfo {
  effectiveLevel: BackendLogLevel;
  sessionLogDir: string;
  appLogPath: string;
  aiLogPath: string;
  webviewLogPath: string;
}

export interface DefaultModels {
  primary: string | null;
  fast: string | null;
  search?: string | null;
  image_understanding?: string | null;
  image_generation?: string | null;
  speech_recognition?: string | null;
}
