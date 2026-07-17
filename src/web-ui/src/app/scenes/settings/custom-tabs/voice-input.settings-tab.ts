import { lazy } from 'react';
import { defineCustomSettingsTab } from '../customSettingsRegistration';

export default defineCustomSettingsTab({
  id: 'voiceInput',
  categoryId: 'smartCapabilities',
  categoryOrder: 200,
  order: 200,
  aliases: ['voice', 'speech', 'microphone', 'dictation', 'sensevoice', 'asr'],
  claimedSettingNamespaces: ['core.app.ai_experience.voice_input'],
  actions: [
    {
      id: 'voice-input.download-model',
      labelKey: 'settings/voice-input:model.download',
      aliases: ['install speech model', 'sensevoice'],
    },
    {
      id: 'voice-input.open-model-location',
      labelKey: 'settings/voice-input:model.openFolder',
      aliases: ['speech model folder', 'model location'],
    },
    {
      id: 'voice-input.delete-model',
      labelKey: 'settings/voice-input:model.delete',
      aliases: ['remove speech model', 'uninstall sensevoice'],
    },
  ],
  component: lazy(() => import('@/infrastructure/config/components/VoiceInputConfig')),
});
