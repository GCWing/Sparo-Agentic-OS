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
import { ConfigPageRow, ConfigPageSection } from '@/infrastructure/config/components/common';
import { useFontPreference } from '../hooks/useFontPreference';
import { FontSizeLevel, PRESET_UI_BASE_PX, UI_FONT_SIZE_PRESETS } from '../types';
import './FontPreferencePanel.scss';

const UI_LEVELS: Array<Exclude<FontSizeLevel, 'custom'>> = ['compact', 'small', 'default', 'medium', 'large'];
const FONT_SIZE_MIN_PX = 12;
const FONT_SIZE_MAX_PX = 20;
const DEFAULT_CUSTOM_FONT_PX = 14;

function clampFontPx(value: string, fallback: number): number {
  const parsed = parseInt(value, 10);
  if (Number.isNaN(parsed)) return fallback;
  return Math.max(FONT_SIZE_MIN_PX, Math.min(FONT_SIZE_MAX_PX, parsed));
}

export function FontPreferencePanel() {
  const { t } = useTranslation('settings/appearance');
  const { preference, setUiSize, setFlowChatFont, setMarkdownEditorFont, reset } = useFontPreference();

  const { level, customPx } = preference.uiSize;
  const [customInput, setCustomInput] = useState<string>(String(customPx ?? 14));
  const [fcBaseInput, setFcBaseInput] = useState<string>(String(preference.flowChat.basePx ?? 14));
  const [mdBaseInput, setMdBaseInput] = useState<string>(String(preference.markdownEditor.basePx ?? 14));

  useEffect(() => {
    if (preference.flowChat.mode === 'independent') {
      setFcBaseInput(String(preference.flowChat.basePx ?? 14));
    }
  }, [preference.flowChat.mode, preference.flowChat.basePx]);

  useEffect(() => {
    if (preference.markdownEditor.mode === 'independent') {
      setMdBaseInput(String(preference.markdownEditor.basePx ?? 14));
    }
  }, [preference.markdownEditor.mode, preference.markdownEditor.basePx]);

  /** Legacy "sync" mode removed from UI: normalize to lift (UI +1). */
  useEffect(() => {
    if (preference.flowChat.mode === 'sync') {
      void setFlowChatFont('lift');
    }
  }, [preference.flowChat.mode, setFlowChatFont]);

  /** Baseline px currently applied in the UI (preset level or custom). */
  const getEffectiveUiBasePx = useCallback((): number => {
    if (level === 'custom') {
      const n = parseInt(customInput, 10);
      if (!isNaN(n) && n >= 12 && n <= 20) return n;
      return customPx ?? 14;
    }
    return PRESET_UI_BASE_PX[level];
  }, [level, customInput, customPx]);

  const handleLevelClick = useCallback(async (l: FontSizeLevel) => {
    if (l === 'custom') {
      const px = getEffectiveUiBasePx();
      setCustomInput(String(px));
      await setUiSize('custom', px);
    } else {
      await setUiSize(l);
    }
  }, [getEffectiveUiBasePx, setUiSize]);

  const handleCustomPxChange = (next: number) => {
    setCustomInput(String(next));
    void setUiSize('custom', next);
  };

  const handleReset = async () => {
    await reset();
    setCustomInput('14');
    setFcBaseInput('14');
    setMdBaseInput('14');
  };

  const previewBasePx = level === 'custom'
    ? (parseInt(customInput, 10) || 14)
    : parseInt(UI_FONT_SIZE_PRESETS[level].base, 10);

  const customLevelLabelPx = (() => {
    if (level !== 'custom') return 14;
    const n = parseInt(customInput, 10);
    return !isNaN(n) && n >= 12 && n <= 20 ? n : 14;
  })();

  const fcIndependent = preference.flowChat.mode === 'independent';
  const mdIndependent = preference.markdownEditor.mode === 'independent';
  const flowChatPxValue = (() => {
    const n = parseInt(fcBaseInput, 10);
    return n >= 12 && n <= 20 ? n : 14;
  })();
  const markdownEditorPxValue = (() => {
    const n = parseInt(mdBaseInput, 10);
    return n >= 12 && n <= 20 ? n : 14;
  })();

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
      const v = clampFontPx(fcBaseInput, DEFAULT_CUSTOM_FONT_PX);
      setFcBaseInput(String(v));
      void setFlowChatFont('independent', v);
    } else {
      void setFlowChatFont('lift');
    }
  };

  const handleFlowChatPxChange = useCallback((next: number) => {
    const clamped = Math.max(FONT_SIZE_MIN_PX, Math.min(FONT_SIZE_MAX_PX, next));
    setFcBaseInput(String(clamped));
    void setFlowChatFont('independent', clamped);
  }, [setFlowChatFont]);

  const handleMarkdownEditorCustomToggle = (enabled: boolean) => {
    if (enabled) {
      const v = clampFontPx(mdBaseInput, DEFAULT_CUSTOM_FONT_PX);
      setMdBaseInput(String(v));
      void setMarkdownEditorFont('independent', v);
    } else {
      void setMarkdownEditorFont('sync');
    }
  };

  const handleMarkdownEditorPxChange = useCallback((next: number) => {
    const clamped = Math.max(FONT_SIZE_MIN_PX, Math.min(FONT_SIZE_MAX_PX, next));
    setMdBaseInput(String(clamped));
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
      {/* UI Font Size */}
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

          {/* Live preview */}
          <div
            className="font-pref-panel__preview"
            style={{ fontSize: `${previewBasePx}px` }}
            aria-label="Font size preview"
          >
            {t('appearance.fontSize.previewText')}
          </div>
        </div>
      </ConfigPageRow>

      {/* Flow chat font scale */}
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

      {/* Markdown editor font scale */}
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

      {/* Reset */}
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
    </ConfigPageSection>
  );
}
