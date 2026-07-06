import React from 'react';
import { ChevronDown, FolderOpen, RotateCcw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  Button,
  Card,
  CardBody,
  Dialog,
  IconButton,
  Input,
  NumberField,
  Switch,
  Textarea,
} from '@/design-system';
import { ConfigPageContent, ConfigPageHeader, ConfigPageLayout, ConfigPageLoading, ConfigPageRow, ConfigPageSection } from './common';
import { LANGUAGE_TEMPLATE_LABELS } from '../types';
import { useSessionSettingsConfig } from './useSessionSettingsConfig';
import './DebugConfig.scss';

const BitFunCoderConfig: React.FC = () => {
  const { t: tApps } = useTranslation('scenes/apps');
  const {
    isLoading,
    debugConfig,
    debugHasChanges,
    debugSaving,
    expandedTemplates,
    isTemplatesModalOpen,
    templateEntries,
    updateDebugConfig,
    saveDebugConfig,
    cancelDebugChanges,
    handleModalSave,
    handleModalCancel,
    resetDebugTemplates,
    updateTemplate,
    toggleTemplateEnabled,
    toggleTemplateExpand,
    handleSelectLogPath,
    setIsTemplatesModalOpen,
    tDebug,
  } = useSessionSettingsConfig({ loadDesktopStatus: false });

  if (isLoading) {
    return (
      <ConfigPageLayout className="sparo-debug-config">
        <ConfigPageHeader
          title={tApps('apps.bitfunCoder.name')}
          description={tApps('apps.bitfunCoder.description')}
        />
        <ConfigPageContent className="sparo-debug-config__content">
          <ConfigPageLoading text={tDebug('messages.loading')} />
        </ConfigPageContent>
      </ConfigPageLayout>
    );
  }

  return (
    <ConfigPageLayout className="sparo-debug-config">
      <ConfigPageHeader
        title={tApps('apps.bitfunCoder.name')}
        description={tApps('apps.bitfunCoder.description')}
      />
      <ConfigPageContent className="sparo-debug-config__content">
        <ConfigPageSection title={tDebug('sections.combined')}>
          <ConfigPageRow
            label={tDebug('settings.logPath.label')}
            description={tDebug('settings.logPath.description')}
          >
            <div className="sparo-debug-config__input-group">
              <Input
                value={debugConfig.log_path}
                onChange={(e) => updateDebugConfig({ log_path: e.target.value })}
                placeholder={tDebug('settings.logPath.placeholder')}
                variant="outlined"
                inputSize="small"
              />
              <IconButton
                variant="default"
                size="small"
                onClick={handleSelectLogPath}
                tooltip={tDebug('settings.logPath.browse')}
              >
                <FolderOpen size={16} />
              </IconButton>
            </div>
          </ConfigPageRow>

          <ConfigPageRow
            label={tDebug('settings.ingestPort.label')}
            description={tDebug('settings.ingestPort.description')}
            align="center"
          >
            <NumberField
              value={debugConfig.ingest_port}
              onChange={(v) => updateDebugConfig({ ingest_port: v })}
              min={1024}
              max={65535}
              step={1}
              size="small"
            />
          </ConfigPageRow>

          {debugHasChanges && !isTemplatesModalOpen && (
            <ConfigPageRow label={tDebug('actions.save')} align="center">
              <div className="sparo-debug-config__settings-actions">
                <Button
                  variant="primary"
                  size="small"
                  onClick={saveDebugConfig}
                  disabled={debugSaving}
                >
                  {debugSaving ? tDebug('actions.saving') : tDebug('actions.save')}
                </Button>
                <Button
                  variant="secondary"
                  size="small"
                  onClick={cancelDebugChanges}
                  disabled={debugSaving}
                >
                  {tDebug('actions.cancel')}
                </Button>
              </div>
            </ConfigPageRow>
          )}

          <ConfigPageRow
            label={tDebug('sections.templates')}
            description={tDebug('templates.description')}
            align="center"
          >
            <Button
              variant="secondary"
              size="small"
              onClick={() => setIsTemplatesModalOpen(true)}
            >
              {tDebug('templates.configure')}
            </Button>
          </ConfigPageRow>
        </ConfigPageSection>

        <Dialog
          open={isTemplatesModalOpen}
          onOpenChange={(nextOpen) => {
            if (!nextOpen) {
              setIsTemplatesModalOpen(false);
            }
          }}
          title={tDebug('sections.templates')}
          titleExtra={(
            <IconButton
              type="button"
              variant="ghost"
              size="xs"
              className="sparo-debug-config__modal-reset-icon"
              onClick={resetDebugTemplates}
              tooltip={tDebug('templates.reset')}
              aria-label={tDebug('templates.reset')}
            >
              <RotateCcw size={12} strokeWidth={2} />
            </IconButton>
          )}
          size="large"
        >
          <div className="sparo-debug-config__modal-body">
            {templateEntries.map(([language, template]) => {
              const isExpanded = expandedTemplates.has(language);
              return (
                <Card
                  key={language}
                  variant="default"
                  padding="none"
                  interactive
                  className={`sparo-debug-config__template-card${isExpanded ? ' is-expanded' : ''}`}
                >
                  <div
                    className="sparo-debug-config__template-header"
                    onClick={() => toggleTemplateExpand(language)}
                  >
                    <div className="sparo-debug-config__template-info">
                      <div onClick={(e) => e.stopPropagation()}>
                        <Switch
                          checked={template.enabled}
                          onChange={() => toggleTemplateEnabled(language, template.enabled)}
                          size="small"
                        />
                      </div>
                      <span className="sparo-debug-config__template-name">
                        {template.display_name || LANGUAGE_TEMPLATE_LABELS[language] || language}
                      </span>
                    </div>
                    <ChevronDown
                      size={16}
                      className={`sparo-debug-config__template-arrow${isExpanded ? ' is-expanded' : ''}`}
                    />
                  </div>

                  {isExpanded && (
                    <CardBody className="sparo-debug-config__template-content">
                      <div className="sparo-debug-config__template-field">
                        <Textarea
                          label={tDebug('templates.instrumentation.label')}
                          value={template.instrumentation_template}
                          onChange={(e) => updateTemplate(language, { instrumentation_template: e.target.value })}
                          placeholder={tDebug('templates.instrumentation.placeholder')}
                          hint={`${tDebug('templates.instrumentation.placeholders')}: {LOCATION}, {MESSAGE}, {DATA}, {PORT}, {SESSION_ID}, {HYPOTHESIS_ID}, {RUN_ID}, {LOG_PATH}`}
                          variant="outlined"
                          autoResize
                        />
                      </div>
                      <div className="sparo-debug-config__template-field">
                        <label className="sparo-debug-config__template-label">
                          {tDebug('templates.region.label')}
                        </label>
                        <div className="sparo-debug-config__region-inputs">
                          <Input
                            value={template.region_start}
                            onChange={(e) => updateTemplate(language, { region_start: e.target.value })}
                            placeholder={tDebug('templates.region.startPlaceholder')}
                            variant="outlined"
                            inputSize="small"
                          />
                          <Input
                            value={template.region_end}
                            onChange={(e) => updateTemplate(language, { region_end: e.target.value })}
                            placeholder={tDebug('templates.region.endPlaceholder')}
                            variant="outlined"
                            inputSize="small"
                          />
                        </div>
                      </div>
                      {template.notes && template.notes.length > 0 && (
                        <div className="sparo-debug-config__template-field">
                          <label className="sparo-debug-config__template-label">
                            {tDebug('templates.notes')}
                          </label>
                          <div className="sparo-debug-config__template-notes">
                            {template.notes.map((note, idx) => (
                              <span key={idx} className="sparo-debug-config__template-note">
                                {note}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}
                    </CardBody>
                  )}
                </Card>
              );
            })}
          </div>

          {debugHasChanges && (
            <div className="sparo-debug-config__modal-footer">
              <Button
                variant="primary"
                size="small"
                onClick={handleModalSave}
                disabled={debugSaving}
              >
                {debugSaving ? tDebug('actions.saving') : tDebug('actions.save')}
              </Button>
              <Button
                variant="secondary"
                size="small"
                onClick={handleModalCancel}
                disabled={debugSaving}
              >
                {tDebug('actions.cancel')}
              </Button>
            </div>
          )}
        </Dialog>
      </ConfigPageContent>
    </ConfigPageLayout>
  );
};

export default BitFunCoderConfig;
