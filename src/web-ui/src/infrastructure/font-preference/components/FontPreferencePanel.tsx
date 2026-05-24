import { useMemo, useState, useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Button,
  NumberField,
  SegmentedControl,
  Select,
  type SelectOption,
  Switch,
} from '@/design-system';
import { ConfigPageRow, ConfigPageSection } from '@/infrastructure/config/components/common';
import { useFontPreference } from '../hooks/useFontPreference';
import { FontSizeLevel, PRESET_UI_BASE_PX, UI_FONT_SIZE_PRESETS } from '../types';
import './FontPreferencePanel.scss';

const UI_LEVELS: Array<Exclude<FontSizeLevel, 'custom'>> = ['compact', 'small', 'default', 'medium', 'large'];
const FLOW_CHAT_PX_OPTIONS = [12, 13, 14, 15, 16, 17, 18, 19, 20];
const MARKDOWN_EDITOR_PX_OPTIONS = [12, 13, 14, 15, 16, 17, 18, 19, 20];

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

  const flowChatPxOptions = useMemo<SelectOption[]>(
    () =>
      FLOW_CHAT_PX_OPTIONS.map((n) => ({
        value: n,
        label: t('appearance.fontSize.flowChatPxOption', { n }),
      })),
    [t]
  );

  const markdownEditorPxOptions = useMemo<SelectOption[]>(
    () =>
      MARKDOWN_EDITOR_PX_OPTIONS.map((n) => ({
        value: n,
        label: t('appearance.fontSize.markdownEditorPxOption', { n }),
      })),
    [t]
  );

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
      const px = parseInt(fcBaseInput, 10);
      const v = isNaN(px) || px < 12 || px > 20 ? 14 : px;
      setFcBaseInput(String(v));
      void setFlowChatFont('independent', v);
    } else {
      void setFlowChatFont('lift');
    }
  };

  const handleFlowChatPxChange = useCallback(
    (v: string | number | (string | number)[]) => {
      if (Array.isArray(v)) return;
      const n = typeof v === 'number' ? v : parseInt(String(v), 10);
      if (Number.isNaN(n)) return;
      setFcBaseInput(String(n));
      void setFlowChatFont('independent', n);
    },
    [setFlowChatFont]
  );

  const handleMarkdownEditorCustomToggle = (enabled: boolean) => {
    if (enabled) {
      const px = parseInt(mdBaseInput, 10);
      const v = isNaN(px) || px < 12 || px > 20 ? 14 : px;
      setMdBaseInput(String(v));
      void setMarkdownEditorFont('independent', v);
    } else {
      void setMarkdownEditorFont('sync');
    }
  };

  const handleMarkdownEditorPxChange = useCallback(
    (v: string | number | (string | number)[]) => {
      if (Array.isArray(v)) return;
      const n = typeof v === 'number' ? v : parseInt(String(v), 10);
      if (Number.isNaN(n)) return;
      setMdBaseInput(String(n));
      void setMarkdownEditorFont('independent', n);
    },
    [setMarkdownEditorFont]
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
        align="start"
      >
        <div className="font-pref-panel__flow-chat">
          <div className="font-pref-panel__flow-chat-line">
            <Switch
              size="small"
              checked={fcIndependent}
              onChange={(e) => handleFlowChatCustomToggle(e.target.checked)}
              label={t('appearance.fontSize.flowChatCustomToggle')}
            />
          </div>
          {fcIndependent && (
            <div className="font-pref-panel__flow-chat-controls">
              <Select
                size="small"
                value={flowChatPxValue}
                options={flowChatPxOptions}
                onChange={handleFlowChatPxChange}
                placement="bottom"
              />
            </div>
          )}
        </div>
      </ConfigPageRow>

      {/* Markdown editor font scale */}
      <ConfigPageRow
        className="font-pref-panel__row--markdown-editor"
        label={t('appearance.fontSize.markdownEditorLabel')}
        description={t('appearance.fontSize.markdownEditorHint')}
        align="start"
      >
        <div className="font-pref-panel__flow-chat">
          <div className="font-pref-panel__flow-chat-line">
            <Switch
              size="small"
              checked={mdIndependent}
              onChange={(e) => handleMarkdownEditorCustomToggle(e.target.checked)}
              label={t('appearance.fontSize.markdownEditorCustomToggle')}
            />
          </div>
          {mdIndependent && (
            <div className="font-pref-panel__flow-chat-controls">
              <Select
                size="small"
                value={markdownEditorPxValue}
                options={markdownEditorPxOptions}
                onChange={handleMarkdownEditorPxChange}
                placement="bottom"
              />
            </div>
          )}
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
