import React, { useEffect, useMemo, useState } from 'react';
import { Trash2, Upload } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { open } from '@tauri-apps/plugin-dialog';
import {
  Button,
  ConfirmDialog,
  Switch,
  Select,
  type SelectOption,
} from '@/design-system';
import { isTauriRuntime } from '@/infrastructure/runtime';
import {
  type AgentCompanionPetSelection,
} from '../services/AIExperienceConfigService';
import {
  BUILTIN_SPARKY_COMPANION_PET,
  deleteAgentCompanionPetPackage,
  importAgentCompanionPetPackage,
  listAgentCompanionPets,
  releaseAgentCompanionPetPreviewBlobs,
  type AgentCompanionPetPackage,
} from '../services/AgentCompanionPetService';
import { ConfigPageContent, ConfigPageHeader, ConfigPageLayout, ConfigPageLoading, ConfigPageMessage, ConfigPageRow, ConfigPageSection } from './common';
import { ModelSelectionRadio } from './ModelSelectionRadio';
import { AGENT_DAILY_LETTER, AGENT_SESSION_TITLE, useSessionSettingsConfig } from './useSessionSettingsConfig';
import './AIFeaturesConfig.scss';

const PersonalizationConfig: React.FC = () => {
  const { t } = useTranslation('settings/personalization');
  const [companionPets, setCompanionPets] = useState<AgentCompanionPetPackage[]>([]);
  const [companionPetsLoading, setCompanionPetsLoading] = useState(false);
  const [companionPetImporting, setCompanionPetImporting] = useState(false);
  const [companionPetDeletingPath, setCompanionPetDeletingPath] = useState<string | null>(null);
  const [deletePetConfirmOpen, setDeletePetConfirmOpen] = useState(false);
  const {
    isLoading,
    settings,
    settingsLoading,
    settingsError,
    enabledModels,
    primaryModelName,
    fastModelName,
    sessionTitleModelId,
    dailyLetterModelId,
    updateSetting,
    handleAgentModelChange,
    handleBuiltinAgentModelChange,
  } = useSessionSettingsConfig({ loadDesktopStatus: false });

  const refreshCompanionPets = React.useCallback(async () => {
    setCompanionPetsLoading(true);
    try {
      setCompanionPets(await listAgentCompanionPets());
    } finally {
      setCompanionPetsLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshCompanionPets();
  }, [refreshCompanionPets]);

  const selectedCompanionPet = settings?.agent_companion_pet
    ? companionPets.find(pet => pet.packagePath === settings.agent_companion_pet?.packagePath)
      ?? settings.agent_companion_pet
    : null;

  const toPetSelection = (pet: AgentCompanionPetSelection): AgentCompanionPetSelection => ({
    id: pet.id,
    displayName: pet.displayName,
    description: pet.description,
    source: pet.source,
    packagePath: pet.packagePath,
    spritesheetPath: pet.spritesheetPath,
    spritesheetMimeType: pet.spritesheetMimeType,
  });

  const companionPetOptions: SelectOption[] = useMemo(() => [
    {
      value: '__default__',
      label: t('features.agentCompanion.defaultPet'),
      description: t('features.agentCompanion.defaultPetDescription'),
    },
    ...companionPets.map(pet => ({
      value: pet.packagePath,
      label: pet.displayName,
      description: pet.description ?? undefined,
      group: pet.source === 'preset'
        ? t('features.agentCompanion.groups.presets')
        : t('features.agentCompanion.groups.imported'),
    })),
  ], [companionPets, t]);

  const handleCompanionPetChange = async (value: string | number | (string | number)[]) => {
    const selectedValue = Array.isArray(value) ? value[0] : value;
    if (selectedValue === '__default__') {
      await updateSetting('agent_companion_pet', toPetSelection(BUILTIN_SPARKY_COMPANION_PET));
      return;
    }

    const pet = companionPets.find(item => item.packagePath === selectedValue);
    if (!pet) return;
    await updateSetting('agent_companion_pet', toPetSelection(pet));
  };

  const handleImportCompanionPet = async () => {
    if (!isTauriRuntime()) return;
    setCompanionPetImporting(true);
    try {
      const selected = await open({
        multiple: false,
        directory: false,
        filters: [{ name: 'Petdex', extensions: ['zip'] }],
      });
      if (typeof selected !== 'string') return;

      const imported = await importAgentCompanionPetPackage(selected);
      await refreshCompanionPets();
      await updateSetting('agent_companion_pet', toPetSelection(imported));
    } finally {
      setCompanionPetImporting(false);
    }
  };

  const handleDeleteCompanionPet = async () => {
    if (!isTauriRuntime() || !selectedCompanionPet || selectedCompanionPet.source !== 'user') return;
    setCompanionPetDeletingPath(selectedCompanionPet.packagePath);
    try {
      await deleteAgentCompanionPetPackage(selectedCompanionPet.packagePath);
      releaseAgentCompanionPetPreviewBlobs(
        selectedCompanionPet.packagePath,
        selectedCompanionPet.spritesheetPath,
      );
      await updateSetting('agent_companion_pet', toPetSelection(BUILTIN_SPARKY_COMPANION_PET));
      await refreshCompanionPets();
    } finally {
      setCompanionPetDeletingPath(null);
    }
  };

  if (isLoading || settingsLoading) {
    return (
      <ConfigPageLayout className="sparo-func-agent-config">
        <ConfigPageHeader title={t('title')} description={t('subtitle')} />
        <ConfigPageContent className="sparo-func-agent-config__content">
          <ConfigPageLoading text={t('loading.text')} />
        </ConfigPageContent>
      </ConfigPageLayout>
    );
  }

  if (settingsError || !settings) {
    return (
      <ConfigPageLayout className="sparo-func-agent-config">
        <ConfigPageHeader title={t('title')} description={t('subtitle')} />
        <ConfigPageContent className="sparo-func-agent-config__content">
          <ConfigPageMessage message={{ type: 'error', text: t('messages.updateFailed') }} />
        </ConfigPageContent>
      </ConfigPageLayout>
    );
  }

  return (
    <ConfigPageLayout className="sparo-func-agent-config">
      <ConfigPageHeader title={t('title')} description={t('subtitle')} />
      <ConfigPageContent className="sparo-func-agent-config__content">
        <ConfigPageSection
          title={t('features.sessionTitle.title')}
        >
          <ConfigPageRow label={t('common.enable')} align="center">
            <div className="sparo-func-agent-config__row-control">
              <Switch
                checked={settings.enable_session_title_generation}
                onChange={(e) => updateSetting('enable_session_title_generation', e.target.checked)}
                size="small"
              />
            </div>
          </ConfigPageRow>
          <ConfigPageRow
            className="sparo-func-agent-config__model-row"
            label={t('model.label')}
            description={enabledModels.length === 0 ? t('models.empty') : undefined}
            align="center"
          >
            <div className="sparo-func-agent-config__row-control sparo-func-agent-config__row-control--model">
              <ModelSelectionRadio
                value={sessionTitleModelId}
                models={enabledModels}
                onChange={(modelId) =>
                  handleAgentModelChange(AGENT_SESSION_TITLE, 'features.sessionTitle.title', modelId)
                }
                disabled={!settings.enable_session_title_generation}
                layout="horizontal"
                size="small"
                interactionMode="focus-custom"
                primaryModelName={primaryModelName}
                fastModelName={fastModelName}
              />
            </div>
          </ConfigPageRow>
        </ConfigPageSection>

        <ConfigPageSection
          title={t('features.dailyLetter.title')}
        >
          <ConfigPageRow label={t('features.dailyLetter.enable')} align="center">
            <div className="sparo-func-agent-config__row-control">
              <Switch
                checked={settings.enable_daily_letter}
                onChange={(e) => updateSetting('enable_daily_letter', e.target.checked)}
                size="small"
              />
            </div>
          </ConfigPageRow>
          <ConfigPageRow
            className="sparo-func-agent-config__model-row"
            label={t('model.label')}
            description={enabledModels.length === 0 ? t('models.empty') : t('features.dailyLetter.subtitle')}
            align="center"
          >
            <div className="sparo-func-agent-config__row-control sparo-func-agent-config__row-control--model">
              <ModelSelectionRadio
                value={dailyLetterModelId}
                models={enabledModels}
                onChange={(modelId) =>
                  handleBuiltinAgentModelChange(AGENT_DAILY_LETTER, 'features.dailyLetter.title', modelId)
                }
                disabled={!settings.enable_daily_letter}
                layout="horizontal"
                size="small"
                interactionMode="focus-custom"
                primaryModelName={primaryModelName}
                fastModelName={fastModelName}
              />
            </div>
          </ConfigPageRow>
        </ConfigPageSection>

        <ConfigPageSection
          title={t('features.agentCompanion.title')}
          extra={(
            <div className="sparo-func-agent-config__page-actions">
              <Button
                variant="secondary"
                size="small"
                onClick={() => void handleImportCompanionPet()}
                disabled={!isTauriRuntime() || companionPetImporting}
              >
                <Upload size={14} />
                {companionPetImporting ? t('features.agentCompanion.importing') : t('features.agentCompanion.import')}
              </Button>
            </div>
          )}
        >
          <ConfigPageRow label={t('features.agentCompanion.enable')} align="center">
            <div className="sparo-func-agent-config__row-control">
              <Switch
                checked={settings.enable_agent_companion}
                onChange={(e) => updateSetting('enable_agent_companion', e.target.checked)}
                size="small"
              />
            </div>
          </ConfigPageRow>
          <ConfigPageRow
            label={t('features.agentCompanion.petLabel')}
            description={t('features.agentCompanion.petDescription')}
          >
            <div className="sparo-func-agent-config__row-control sparo-func-agent-config__row-control--model">
              <Select
                size="small"
                value={settings.agent_companion_pet?.packagePath ?? ''}
                options={companionPetOptions}
                loading={companionPetsLoading}
                onChange={handleCompanionPetChange}
                placeholder={t('features.agentCompanion.petPlaceholder')}
              />
              {selectedCompanionPet?.source === 'user' && (
                <div className="sparo-func-agent-config__page-actions">
                  <Button
                    variant="danger"
                    size="small"
                    onClick={() => setDeletePetConfirmOpen(true)}
                    disabled={companionPetDeletingPath === selectedCompanionPet.packagePath}
                  >
                    <Trash2 size={14} />
                    {t('features.agentCompanion.delete')}
                  </Button>
                </div>
              )}
            </div>
          </ConfigPageRow>
        </ConfigPageSection>

        <ConfigPageSection
          title={t('features.thinkingProcess.title')}
        >
          <ConfigPageRow
            label={t('features.thinkingProcess.showProcess')}
            description={t('features.thinkingProcess.showProcessDescription')}
            align="center"
          >
            <div className="sparo-func-agent-config__row-control">
              <Switch
                checked={settings.show_thinking_process}
                onChange={(e) => updateSetting('show_thinking_process', e.target.checked)}
                size="small"
              />
            </div>
          </ConfigPageRow>
          <ConfigPageRow
            label={t('features.thinkingProcess.keepCompletedItem')}
            description={t('features.thinkingProcess.keepCompletedItemDescription')}
            align="center"
          >
            <div className="sparo-func-agent-config__row-control">
              <Switch
                checked={settings.show_completed_thinking_item}
                disabled={!settings.show_thinking_process}
                onChange={(e) => updateSetting('show_completed_thinking_item', e.target.checked)}
                size="small"
              />
            </div>
          </ConfigPageRow>
        </ConfigPageSection>

        <ConfirmDialog
          open={deletePetConfirmOpen}
          onOpenChange={setDeletePetConfirmOpen}
          onConfirm={() => void handleDeleteCompanionPet()}
          title={t('features.agentCompanion.deleteDialog.title')}
          message={t('features.agentCompanion.deleteDialog.message', {
            name: selectedCompanionPet?.displayName ?? t('features.agentCompanion.petLabel'),
          })}
          type="warning"
          confirmDanger
          confirmText={t('features.agentCompanion.deleteDialog.confirm')}
          cancelText={t('features.agentCompanion.deleteDialog.cancel')}
        />
      </ConfigPageContent>
    </ConfigPageLayout>
  );
};

export default PersonalizationConfig;
