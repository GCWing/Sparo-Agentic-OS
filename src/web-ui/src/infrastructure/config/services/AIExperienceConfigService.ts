 

import { configManager } from './ConfigManager';
import { createLogger } from '@/shared/utils/logger';

const log = createLogger('AIExperienceConfig');

export interface AIExperienceSettings {
  /** Whether Daily Letter generation is enabled. */
  enable_daily_letter: boolean;
  enable_session_title_generation: boolean;
  enable_visual_mode: boolean;
  /** Desktop Agent companion. */
  enable_agent_companion: boolean;
  /** Legacy persisted setting. The companion now always uses the desktop surface. */
  agent_companion_display_mode: AgentCompanionDisplayMode;
  /** Optional Petdex-compatible companion package selected by the user. */
  agent_companion_pet?: AgentCompanionPetSelection | null;
  /** Whether to show model thinking process in FlowChat. */
  show_thinking_process: boolean;
  /** Whether completed thinking blocks remain as expandable collapsed items. */
  show_completed_thinking_item: boolean;
}

export type AgentCompanionDisplayMode = 'desktop';

export interface AgentCompanionPetSelection {
  id: string;
  displayName: string;
  description?: string | null;
  source: 'preset' | 'user';
  packagePath: string;
  spritesheetPath: string;
  spritesheetMimeType: string;
}

export const DEFAULT_AGENT_COMPANION_PET: AgentCompanionPetSelection = {
  id: 'sparky',
  displayName: 'Sparky',
  description: 'A cute non-pixel Sparo-inspired desktop companion with warm red-orange energy and calm agentic focus.',
  source: 'preset',
  packagePath: '/agent-companion-pets/sparky',
  spritesheetPath: '/agent-companion-pets/sparky/spritesheet.webp',
  spritesheetMimeType: 'image/webp',
};

const CONFIG_PATH = 'app.ai_experience';

const defaultSettings: AIExperienceSettings = {
  enable_daily_letter: true,
  enable_session_title_generation: true,
  enable_visual_mode: false,
  enable_agent_companion: true,
  agent_companion_display_mode: 'desktop',
  agent_companion_pet: DEFAULT_AGENT_COMPANION_PET,
  show_thinking_process: true,
  show_completed_thinking_item: true,
};

function normalizeSettings(settings: Partial<AIExperienceSettings> | null | undefined): AIExperienceSettings {
  const merged = { ...defaultSettings, ...settings };
  merged.agent_companion_display_mode = 'desktop';
  if (!merged.agent_companion_pet) {
    merged.agent_companion_pet = DEFAULT_AGENT_COMPANION_PET;
  }
  return merged;
}

 
export class AIExperienceConfigService {
  private static instance: AIExperienceConfigService;
  private cachedSettings: AIExperienceSettings | null = null;
  private listeners: Set<(settings: AIExperienceSettings) => void> = new Set();
  private unwatchConfig: (() => void) | null = null;

  private constructor() {
    // Defer configManager access to avoid circular dependency TDZ at module evaluation time.
    // By the next microtask, all ESM modules have finished evaluating and configManager is available.
    Promise.resolve().then(() => {
      this.unwatchConfig = configManager.watch(CONFIG_PATH, () => {
        this.reload();
      });
      this.loadSettings();
    });
  }

   
  static getInstance(): AIExperienceConfigService {
    if (!AIExperienceConfigService.instance) {
      AIExperienceConfigService.instance = new AIExperienceConfigService();
    }
    return AIExperienceConfigService.instance;
  }

   
  private async loadSettings(): Promise<void> {
    try {
      const settings = await configManager.getConfig<AIExperienceSettings>(CONFIG_PATH);
      this.cachedSettings = normalizeSettings(settings);
    } catch (error) {
      log.warn('Failed to load config, using defaults', error);
      this.cachedSettings = defaultSettings;
    }
  }

   
  getSettings(): AIExperienceSettings {
    if (this.cachedSettings) {
      return { ...this.cachedSettings };
    }
    
    return { ...defaultSettings };
  }

   
  async getSettingsAsync(): Promise<AIExperienceSettings> {
    try {
      const settings = await configManager.getConfig<AIExperienceSettings>(CONFIG_PATH);
      this.cachedSettings = normalizeSettings(settings);
      return this.cachedSettings;
    } catch (error) {
      log.error('Failed to get config', error);
      return this.getSettings(); 
    }
  }

   
  async saveSettings(settings: AIExperienceSettings): Promise<void> {
    try {
      const normalizedSettings = normalizeSettings(settings);
      await configManager.setConfig(CONFIG_PATH, normalizedSettings);
      this.cachedSettings = normalizedSettings;
      this.notifyListeners();
    } catch (error) {
      log.error('Failed to save config', error);
      throw error;
    }
  }

   
  isSessionTitleGenerationEnabled(): boolean {
    return this.getSettings().enable_session_title_generation;
  }

  addChangeListener(listener: (settings: AIExperienceSettings) => void): () => void {
    this.listeners.add(listener);
    
    
    return () => {
      this.listeners.delete(listener);
    };
  }

   
  private notifyListeners(): void {
    this.listeners.forEach(listener => {
      try {
        listener(this.getSettings());
      } catch (error) {
        log.error('Listener execution failed', error);
      }
    });
  }

   
  async reload(): Promise<void> {
    await this.loadSettings();
    this.notifyListeners();
  }

   
  dispose(): void {
    if (this.unwatchConfig) {
      this.unwatchConfig();
      this.unwatchConfig = null;
    }
    this.listeners.clear();
  }
}

 
export const aiExperienceConfigService = AIExperienceConfigService.getInstance();

