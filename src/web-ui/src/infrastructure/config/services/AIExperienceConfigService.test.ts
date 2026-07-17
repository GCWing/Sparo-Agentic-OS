import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AIExperienceConfig } from '../types';

const configManager = vi.hoisted(() => ({
  getSetting: vi.fn(),
  setSetting: vi.fn(),
}));

vi.mock('./ConfigManager', () => ({ configManager }));

import {
  AI_EXPERIENCE_SETTING_NAMESPACE,
  aiExperienceConfigService,
} from './AIExperienceConfigService';

const SETTINGS: AIExperienceConfig = {
  enable_daily_letter: false,
  enable_session_title_generation: false,
  enable_visual_mode: true,
  enable_agent_companion: false,
  agent_companion_pet: null,
  show_thinking_process: false,
  show_completed_thinking_item: false,
  voice_input: {
    enabled: false,
    default_language: 'zh',
    max_recording_seconds: 45,
  },
};

describe('AIExperienceConfigService', () => {
  beforeEach(() => {
    configManager.getSetting.mockReset();
    configManager.setSetting.mockReset();
  });

  it('returns the authoritative projection without filling frontend defaults', async () => {
    configManager.getSetting.mockResolvedValue(SETTINGS);

    await expect(aiExperienceConfigService.getSettings()).resolves.toBe(SETTINGS);
    expect(configManager.getSetting).toHaveBeenCalledWith(AI_EXPERIENCE_SETTING_NAMESPACE);
  });

  it('propagates projection failures instead of reporting a successful default', async () => {
    const error = new Error('snapshot unavailable');
    configManager.getSetting.mockRejectedValue(error);

    await expect(aiExperienceConfigService.getSettings()).rejects.toBe(error);
  });

  it('writes the caller projection unchanged', async () => {
    configManager.setSetting.mockResolvedValue(undefined);

    await aiExperienceConfigService.saveSettings(SETTINGS);

    expect(configManager.setSetting).toHaveBeenCalledWith(
      AI_EXPERIENCE_SETTING_NAMESPACE,
      SETTINGS,
    );
  });
});
