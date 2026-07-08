/**
 * SettingsScene - self-contained settings page with internal left-right layout.
 *
 * Previous design: SettingsNav was injected into the outer navigation via nav-registry.
 * New design: SettingsNav is embedded directly inside this scene, forming a
 * standalone left-right layout that does not depend on the outer navigation shell.
 *
 * Layout: SettingsNav (220px) beside the active settings content.
 */

import React, { lazy, Suspense } from 'react';
import { useSettingsStore } from './settingsStore';
import SettingsNav from './SettingsNav';
import './SettingsScene.scss';
import AIModelConfig from '../../../infrastructure/config/components/AIModelConfig';
import AIUsageConfig from '../../../infrastructure/config/components/AIUsageConfig';
import PersonalizationConfig from '../../../infrastructure/config/components/PersonalizationConfig';
import VoiceInputConfig from '../../../infrastructure/config/components/VoiceInputConfig';
import BitFunCoderConfig from '../../../infrastructure/config/components/BitFunCoderConfig';
import PermissionsConfig from '../../../infrastructure/config/components/PermissionsConfig';
import MemoryConfig from '../../../infrastructure/config/components/MemoryConfig';
import EditorConfig from '../../../infrastructure/config/components/EditorConfig';
import AppearanceConfig from '../../../infrastructure/config/components/AppearanceConfig';
import BasicsConfig from '../../../infrastructure/config/components/BasicsConfig';
import DataStorageConfig from '../../../infrastructure/config/components/DataStorageConfig';

const KeyboardShortcutsTab = lazy(() => import('./components/KeyboardShortcutsTab'));

const SettingsScene: React.FC = () => {
  const activeTab = useSettingsStore(s => s.activeTab);

  let Content: React.ComponentType | null = null;

  if (activeTab === 'keyboard') {
    Content = () => (
      <Suspense fallback={null}>
        <KeyboardShortcutsTab />
      </Suspense>
    );
  } else {
    switch (activeTab) {
      case 'appearance':       Content = AppearanceConfig; break;
      case 'basics':           Content = BasicsConfig;     break;
      case 'models':           Content = AIModelConfig;    break;
      case 'aiUsage':          Content = AIUsageConfig;    break;
      case 'dataStorage':      Content = DataStorageConfig; break;
      case 'personalization':  Content = PersonalizationConfig; break;
      case 'voiceInput':       Content = VoiceInputConfig; break;
      case 'bitfunCoder':      Content = BitFunCoderConfig; break;
      case 'permissions':      Content = PermissionsConfig; break;
      case 'memory':           Content = MemoryConfig; break;
      case 'editor':           Content = EditorConfig;     break;
    }
  }

  return (
    <div className="sparo-settings-scene">
      {/* Left: settings navigation (embedded, not injected via nav-registry) */}
      <div className="sparo-settings-scene__nav">
        <SettingsNav />
      </div>

      {/* Right: active settings content */}
      <div className="sparo-settings-scene__content">
        {Content && (
          <div key={activeTab} className="sparo-settings-scene__content-wrapper">
            <Content />
          </div>
        )}
      </div>
    </div>
  );
};

export default SettingsScene;
