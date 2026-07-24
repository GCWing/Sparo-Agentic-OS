import React, { useMemo } from 'react';
import {
  Download,
  Eye,
  FileText,
  GalleryHorizontal,
  Images,
  Palette,
  Presentation,
  ScanSearch,
  ScanText,
  Undo2,
  type LucideIcon,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { ToolCardProps } from '../types/flow-chat';
import { getToolViewState } from '../runtime/toolViewState';
import {
  hasVisibleValue,
  parseData,
  readPath,
  resolveBridgeError,
  resolveFieldValue,
  resolveLocalizedCard,
  resolveOutputData,
  resolveSummary,
  stringifyValue,
} from './AppDefinedToolCard';
import { DetailToolTemplate } from './templates';
import { ToolErrorBlock } from './ToolErrorBlock';
import { ToolJsonPreview } from './ToolJsonPreview';
import { ToolStructuredDetails } from './ToolStructuredDetails';
import { getToolCardStatusFromViewState } from './toolStatus';
import './PptLiveToolCard.scss';

const PPT_TOOL_ICONS: Array<[string, LucideIcon]> = [
  ['commit_presentation_manuscript', FileText],
  ['review_presentation_manuscript', ScanText],
  ['set_presentation_system', Palette],
  ['render_design_case', GalleryHorizontal],
  ['prepare_visual_assets', Images],
  ['generate_slide_visual', Presentation],
  ['inspect_presentation', Eye],
  ['edit_visual', Palette],
  ['review_deck', ScanSearch],
  ['export_deck', Download],
  ['undo_deck', Undo2],
];

function normalizeToolName(toolName: string): string {
  return toolName.toLowerCase().replace(/-/g, '_');
}

function resolveToolIcon(toolName: string): LucideIcon {
  const normalized = normalizeToolName(toolName);
  return PPT_TOOL_ICONS.find(([suffix]) => normalized.includes(suffix))?.[1] ?? Presentation;
}

export const PptLiveToolCard: React.FC<ToolCardProps> = React.memo(({
  toolItem,
  config,
  onExpand,
}) => {
  const { t, i18n } = useTranslation('flow-chat');
  const { toolCall, toolResult, status } = toolItem;
  const card = useMemo(
    () => resolveLocalizedCard(config.extensionCard ?? {}, i18n.language),
    [config.extensionCard, i18n.language],
  );
  const viewState = useMemo(() => getToolViewState(toolItem), [toolItem]);
  const inputData = useMemo(() => parseData(toolCall?.input), [toolCall?.input]);
  const resultData = useMemo(() => parseData(toolResult?.result), [toolResult?.result]);
  const outputData = resolveOutputData(resultData);
  const templateValues = useMemo(() => ({
    input: inputData,
    result: resultData,
    output: resolveOutputData(resultData),
    action: readPath(resultData, ['action']) ?? readPath(resultData, ['bridge', 'action']) ?? readPath(inputData, ['action']),
    status: readPath(resultData, ['status']) ?? readPath(resultData, ['bridge', 'status']),
    runId: readPath(resultData, ['run_id']) ?? readPath(resultData, ['bridge', 'run_id']) ?? readPath(inputData, ['runId']),
  }), [inputData, resultData]);
  const bridgeStatus = stringifyValue(readPath(templateValues, ['status']));
  const isCancelled = viewState.phase === 'cancelled'
    || bridgeStatus === 'cancelled'
    || status === 'cancelled';
  const isFailed = !isCancelled && (
    viewState.phase === 'error'
    || bridgeStatus === 'failed'
    || toolResult?.success === false
    || status === 'error'
  );
  const presentationPhase = isCancelled
    ? 'cancelled'
    : isFailed
      ? 'error'
      : viewState.phase;
  const toolStatus = isCancelled
    ? 'cancelled'
    : isFailed
      ? 'error'
      : getToolCardStatusFromViewState(viewState);
  const errorMessage = resolveBridgeError(resultData, toolResult?.error)
    ?? (isFailed ? t('toolCards.default.failed') : undefined);
  const resolvedFields = (card.fields ?? [])
    .map(field => ({ field, value: resolveFieldValue(field, inputData, resultData) }))
    .filter(({ value }) => hasVisibleValue(value));
  const textFields = resolvedFields.filter(({ field }) => field.format !== 'json');
  const jsonFields = resolvedFields.filter(({ field }) => field.format === 'json');
  const fallbackOutput = resolvedFields.length === 0 && hasVisibleValue(outputData)
    ? outputData
    : undefined;
  const summary = resolveSummary(card, presentationPhase, templateValues, {
    preparing: t('toolCards.default.preparing'),
    running: t('toolCards.default.executing'),
    confirming: t('toolCards.default.waitingConfirm'),
    completed: t('toolCards.default.completed'),
    failed: t('toolCards.default.failed'),
    cancelled: t('toolCards.default.cancelled'),
  });
  const expandedContent = resolvedFields.length > 0 || fallbackOutput !== undefined ? (
    <ToolStructuredDetails
      rows={textFields.map(({ field, value }) => ({
        label: `${field.label}:`,
        value: stringifyValue(value),
      }))}
      className="ppt-live-tool-card__details"
    >
      {jsonFields.map(({ field, value }) => (
        <div
          key={`${field.label}-${field.resultPath?.join('.') ?? field.inputPath?.join('.') ?? ''}`}
          className="ppt-live-tool-card__json-field"
        >
          <div className="ppt-live-tool-card__json-label">{field.label}</div>
          <ToolJsonPreview value={value} maxChars={3200} />
        </div>
      ))}
      {fallbackOutput !== undefined && <ToolJsonPreview value={fallbackOutput} maxChars={3200} />}
    </ToolStructuredDetails>
  ) : undefined;
  const visibleBridgeStatus = bridgeStatus && !['completed', 'failed', 'cancelled'].includes(bridgeStatus)
    ? bridgeStatus
    : undefined;
  const ToolIcon = resolveToolIcon(toolItem.toolName);
  const title = card.title ?? card.displayName ?? config.displayName;

  return (
    <div className="ppt-live-tool-card">
      <DetailToolTemplate
        toolId={toolItem.id ?? toolCall?.id}
        toolName={toolItem.toolName}
        status={toolStatus}
        icon={<ToolIcon size={15} strokeWidth={1.8} />}
        action={title}
        subject={summary}
        extra={(
          <div className="ppt-live-tool-card__meta">
            {visibleBridgeStatus && (
              <span className="ppt-live-tool-card__bridge-status">{visibleBridgeStatus}</span>
            )}
            <span className="ppt-live-tool-card__brand">{t('toolCards.pptLive.brand')}</span>
          </div>
        )}
        expandedContent={expandedContent}
        errorContent={errorMessage ? <ToolErrorBlock message={errorMessage} /> : undefined}
        isFailed={isFailed}
        className="ppt-live-tool-card__template"
        onExpand={onExpand}
      />
    </div>
  );
});

PptLiveToolCard.displayName = 'PptLiveToolCard';

export default PptLiveToolCard;
