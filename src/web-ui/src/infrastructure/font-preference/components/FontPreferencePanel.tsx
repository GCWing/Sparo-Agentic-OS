import { useMemo, useState, useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';
import {
  Button,
  IconButton,
  NumberField,
  SegmentedControl,
  Switch,
} from '@/design-system';
import {
  ConfigPageLoading,
  ConfigPageMessage,
  ConfigPageRow,
  ConfigPageSection,
} from '@/infrastructure/config/components/common';
import { useFontPreference } from '../hooks/useFontPreference';
import {
  type FontPreference,
  type FontSizeLevel,
  PRESET_UI_BASE_PX,
  UI_FONT_SIZE_PRESETS,
} from '../types';
import './FontPreferencePanel.scss';

const UI_LEVELS: Array<Exclude<FontSizeLevel, 'custom'>> = ['compact', 'small', 'default', 'medium', 'large'];
const FONT_SIZE_MIN_PX = 12;
const FONT_SIZE_MAX_PX = 20;
function clampFontPx(value: number): number {
  return Math.max(FONT_SIZE_MIN_PX, Math.min(FONT_SIZE_MAX_PX, Math.round(value)));
}

function resolveUiBasePx(preference: FontPreference): number {
  if (preference.uiSize.level !== 'custom') {
    return PRESET_UI_BASE_PX[preference.uiSize.level];
  }
  if (preference.uiSize.customPx === null) {
    throw new Error('Custom UI font size is missing from the accepted font snapshot');
  }
  return preference.uiSize.customPx;
}

export interface FontPreferencePanelProps {
  /** Undefined renders the complete manual font section. */
  settingIds?: readonly string[];
}

function includesFontSetting(
  settingIds: readonly string[] | undefined,
  namespace: string,
): boolean {
  return settingIds === undefined || settingIds.some(
    (settingId) => settingId === namespace || settingId.startsWith(`${namespace}.`),
  );
}

export function FontPreferencePanel({ settingIds }: FontPreferencePanelProps = {}) {
  const { t } = useTranslation('settings/appearance');
  const { t: tCommon } = useTranslation('common');
  const fontPreference = useFontPreference();
  const showUiSize = includesFontSetting(settingIds, 'core.font.ui_size');
  const showFlowChat = includesFontSetting(settingIds, 'core.font.flow_chat');
  const showMarkdownEditor = includesFontSetting(settingIds, 'core.font.markdown_editor');

  if (!showUiSize && !showFlowChat && !showMarkdownEditor) {
    return null;
  }

  if (fontPreference.loading || (!fontPreference.initialized && !fontPreference.error)) {
    return (
      <ConfigPageSection title={t('appearance.fontSize.title')}>
        <ConfigPageLoading text={t('appearance.fontSize.loading')} />
      </ConfigPageSection>
    );
  }

  if (fontPreference.error || !fontPreference.preference) {
    return (
      <ConfigPageSection title={t('appearance.fontSize.title')}>
        <ConfigPageMessage
          message={{ type: 'error', text: t('appearance.fontSize.loadFailed') }}
        />
        <Button variant="secondary" size="small" onClick={() => void fontPreference.retry()}>
          {tCommon('actions.retry')}
        </Button>
      </ConfigPageSection>
    );
  }

  return (
    <FontPreferenceControls
      preference={fontPreference.preference}
      setUiSize={fontPreference.setUiSize}
      setFlowChatFont={fontPreference.setFlowChatFont}
      setMarkdownEditorFont={fontPreference.setMarkdownEditorFont}
      reset={fontPreference.reset}
      showUiSize={showUiSize}
      showFlowChat={showFlowChat}
      showMarkdownEditor={showMarkdownEditor}
      showReset={settingIds === undefined}
    />
  );
}

interface FontPreferenceControlsProps {
  preference: FontPreference;
  setUiSize: ReturnType<typeof useFontPreference>['setUiSize'];
  setFlowChatFont: ReturnType<typeof useFontPreference>['setFlowChatFont'];
  setMarkdownEditorFont: ReturnType<typeof useFontPreference>['setMarkdownEditorFont'];
  reset: ReturnType<typeof useFontPreference>['reset'];
  showUiSize: boolean;
  showFlowChat: boolean;
  showMarkdownEditor: boolean;
  showReset: boolean;
}

function FontPreferenceControls({
  preference,
  setUiSize,
  setFlowChatFont,
  setMarkdownEditorFont,
  reset,
  showUiSize,
  showFlowChat,
  showMarkdownEditor,
  showReset,
}: FontPreferenceControlsProps) {
  const { t } = useTranslation('settings/appearance');

  const { level } = preference.uiSize;
  const authoritativeUiBasePx = resolveUiBasePx(preference);
  const [customInput, setCustomInput] = useState<number>(authoritativeUiBasePx);
  const [fcBaseInput, setFcBaseInput] = useState<number>(
    preference.flowChat.basePx ?? authoritativeUiBasePx,
  );
  const [mdBaseInput, setMdBaseInput] = useState<number>(
    preference.markdownEditor.basePx ?? authoritativeUiBasePx,
  );

  useEffect(() => {
    setCustomInput(authoritativeUiBasePx);
  }, [authoritativeUiBasePx]);

  useEffect(() => {
    setFcBaseInput(preference.flowChat.basePx ?? authoritativeUiBasePx);
  }, [authoritativeUiBasePx, preference.flowChat.basePx]);

  useEffect(() => {
    setMdBaseInput(preference.markdownEditor.basePx ?? authoritativeUiBasePx);
  }, [authoritativeUiBasePx, preference.markdownEditor.basePx]);

  /** Baseline px currently applied in the UI (preset level or custom). */
  const getEffectiveUiBasePx = useCallback((): number => {
    if (level === 'custom') {
      return clampFontPx(customInput);
    }
    return PRESET_UI_BASE_PX[level];
  }, [customInput, level]);

  const handleLevelClick = useCallback(async (l: FontSizeLevel) => {
    if (l === 'custom') {
      const px = getEffectiveUiBasePx();
      setCustomInput(px);
      await setUiSize('custom', px);
    } else {
      await setUiSize(l);
    }
  }, [getEffectiveUiBasePx, setUiSize]);

  const handleCustomPxChange = (next: number) => {
    const clamped = clampFontPx(next);
    setCustomInput(clamped);
    void setUiSize('custom', clamped);
  };

  const handleReset = async () => {
    await reset();
  };

  const previewBasePx = level === 'custom'
    ? customInput
    : PRESET_UI_BASE_PX[level];

  const customLevelLabelPx = customInput;

  const fcIndependent = preference.flowChat.mode === 'independent';
  const mdIndependent = preference.markdownEditor.mode === 'independent';
  const flowChatPxValue = clampFontPx(fcBaseInput);
  const markdownEditorPxValue = clampFontPx(mdBaseInput);

  const uiLevelOptions = useMemo(
    () =>
      [...UI_LEVELS, 'custom' as const].map((l) => ({
        value: l,
        label: (
          <span
            className="font-pref-panel__level-label"
            style={{ fontSize: l === 'custom' ? `${customLevelLabelPx}px` : UI_FONT_SIZE_PRESETS[l].base }}
          >
            {t(`appearance.fontSize.levels.${l}`)}
          </span>
        ),
      })),
    [customLevelLabelPx, t]
  );

  const handleFlowChatCustomToggle = (enabled: boolean) => {
    if (enabled) {
      const v = clampFontPx(fcBaseInput);
      setFcBaseInput(v);
      void setFlowChatFont('independent', v);
    } else {
      void setFlowChatFont('sync');
    }
  };

  const handleFlowChatPxChange = useCallback((next: number) => {
    const clamped = clampFontPx(next);
    setFcBaseInput(clamped);
    void setFlowChatFont('independent', clamped);
  }, [setFlowChatFont]);

  const handleMarkdownEditorCustomToggle = (enabled: boolean) => {
    if (enabled) {
      const v = clampFontPx(mdBaseInput);
      setMdBaseInput(v);
      void setMarkdownEditorFont('independent', v);
    } else {
      void setMarkdownEditorFont('sync');
    }
  };

  const handleMarkdownEditorPxChange = useCallback((next: number) => {
    const clamped = clampFontPx(next);
    setMdBaseInput(clamped);
    void setMarkdownEditorFont('independent', clamped);
  }, [setMarkdownEditorFont]);

  const renderExpandableFontControl = ({
    enabled,
    value,
    toggleLabel,
    inputLabel,
    onToggle,
    onValueChange,
  }: {
    enabled: boolean;
    value: number;
    toggleLabel: string;
    inputLabel: string;
    onToggle: (enabled: boolean) => void;
    onValueChange: (value: number) => void;
  }) => (
    <div className={`font-pref-panel__custom-capsule ${enabled ? 'font-pref-panel__custom-capsule--expanded' : ''}`}>
      {!enabled ? (
        <Switch
          className="font-pref-panel__custom-switch"
          size="small"
          checked={false}
          onChange={(e) => onToggle(e.target.checked)}
          aria-label={toggleLabel}
        />
      ) : (
        <>
          <NumberField
            className="font-pref-panel__custom-number-field"
            size="small"
            value={value}
            min={FONT_SIZE_MIN_PX}
            max={FONT_SIZE_MAX_PX}
            step={1}
            unit="px"
            onChange={onValueChange}
            label={inputLabel}
            increaseAriaLabel="+1"
            decreaseAriaLabel="-1"
          />
          <IconButton
            className="font-pref-panel__custom-close"
            variant="ghost"
            size="xs"
            shape="circle"
            aria-label={toggleLabel}
            tooltip={toggleLabel}
            onClick={() => onToggle(false)}
          >
            <X size={12} aria-hidden="true" />
          </IconButton>
        </>
      )}
    </div>
  );

  return (
    <ConfigPageSection
      title={t('appearance.fontSize.title')}
    >
      {showUiSize ? (
        <ConfigPageRow
          className="font-pref-panel__row--ui"
          label={t('appearance.fontSize.uiSizeLabel')}
          description={t('appearance.fontSize.uiSizeHint')}
          align="start"
          multiline
        >
          <div className="font-pref-panel__ui-size">
            <div className="font-pref-panel__ui-segment-block">
              <div className="font-pref-panel__level-controls">
                <SegmentedControl
                  className="font-pref-panel__level-segments"
                  size="small"
                  value={level}
                  onChange={(next) => void handleLevelClick(next as FontSizeLevel)}
                  ariaLabel={t('appearance.fontSize.uiSizeLabel')}
                  options={uiLevelOptions}
                />
                {level === 'custom' && (
                  <NumberField
                    className="font-pref-panel__custom-number"
                    value={customLevelLabelPx}
                    min={12}
                    max={20}
                    step={1}
                    unit="px"
                    size="small"
                    variant="stepper"
                    onChange={handleCustomPxChange}
                    label={t('appearance.fontSize.customPxLabel')}
                    increaseAriaLabel="+1"
                    decreaseAriaLabel="-1"
                  />
                )}
              </div>
            </div>

            <div
              className="font-pref-panel__preview"
              style={{ fontSize: `${previewBasePx}px` }}
              aria-label="Font size preview"
            >
              {t('appearance.fontSize.previewText')}
            </div>
          </div>
        </ConfigPageRow>
      ) : null}

      {showFlowChat ? (
        <ConfigPageRow
          className="font-pref-panel__row--flow-chat"
          label={t('appearance.fontSize.flowChatLabel')}
          description={t('appearance.fontSize.flowChatHint')}
          align="center"
        >
          <div className="font-pref-panel__flow-chat">
            {renderExpandableFontControl({
              enabled: fcIndependent,
              value: flowChatPxValue,
              toggleLabel: t('appearance.fontSize.flowChatCustomToggle'),
              inputLabel: t('appearance.fontSize.customPxLabel'),
              onToggle: handleFlowChatCustomToggle,
              onValueChange: handleFlowChatPxChange,
            })}
          </div>
        </ConfigPageRow>
      ) : null}

      {showMarkdownEditor ? (
        <ConfigPageRow
          className="font-pref-panel__row--markdown-editor"
          label={t('appearance.fontSize.markdownEditorLabel')}
          description={t('appearance.fontSize.markdownEditorHint')}
          align="center"
        >
          <div className="font-pref-panel__flow-chat">
            {renderExpandableFontControl({
              enabled: mdIndependent,
              value: markdownEditorPxValue,
              toggleLabel: t('appearance.fontSize.markdownEditorCustomToggle'),
              inputLabel: t('appearance.fontSize.customPxLabel'),
              onToggle: handleMarkdownEditorCustomToggle,
              onValueChange: handleMarkdownEditorPxChange,
            })}
          </div>
        </ConfigPageRow>
      ) : null}

      {showReset ? (
        <ConfigPageRow label="" align="center">
          <Button
            variant="secondary"
            size="small"
            className="font-pref-panel__reset-action"
            onClick={() => void handleReset()}
          >
            {t('appearance.fontSize.resetButton')}
          </Button>
        </ConfigPageRow>
      ) : null}
    </ConfigPageSection>
  );
}
