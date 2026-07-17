import { configManager } from './ConfigManager';
import type { AIExperienceConfig } from '../types';

export type AIExperienceSettings = AIExperienceConfig;
export type { AgentCompanionPetSelection } from '../types';

export const AI_EXPERIENCE_SETTING_NAMESPACE = 'core.app.ai_experience';

/** Stateless projection over the authoritative config catalog and snapshot. */
export const aiExperienceConfigService = {
  async getSettings(): Promise<AIExperienceSettings> {
    return configManager.getSetting<AIExperienceSettings>(AI_EXPERIENCE_SETTING_NAMESPACE);
  },

  async saveSettings(settings: AIExperienceSettings): Promise<void> {
    await configManager.setSetting(AI_EXPERIENCE_SETTING_NAMESPACE, settings);
  },
};
