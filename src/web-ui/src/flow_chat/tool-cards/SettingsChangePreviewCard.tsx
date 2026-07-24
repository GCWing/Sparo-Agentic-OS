import React, { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { ExternalLink, RotateCcw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  Button,
  FormField,
  IconButton,
  ToolCard,
  ToolCardBody,
  ToolCardFooter,
  ToolCardHeader,
} from '@/design-system';
import { useSettingsStore } from '@/app/scenes/settings/settingsStore';
import {
  configCatalogStore,
  configSnapshotStore,
  type ConfigApplyReceipt,
  type ConfigApplyReceiptStatus,
  type ConfigCommit,
  type ConfigPlan,
  type ConfigPlanChange,
  type ConfigPlanWarning,
  type ConfigStoredValue,
  type ConfigValueChange,
  type SettingApplyStrategy,
  type SettingDescriptor,
  type SettingRisk,
  type SettingsSectionRef,
} from '@/infrastructure/config';
import { configAPI } from '@/infrastructure/api';
import type { ToolCardProps } from '../types/flow-chat';
import { getToolViewState, type ToolPresentationPhase } from '../runtime/toolViewState';
import { CompactToolCard } from './CompactToolCard';
import { ToolCompactHeaderLayout } from './ToolHeaderLayout';
import './SettingsChangePreviewCard.scss';

type JsonRecord = Record<string, unknown>;
type SettingsChangeAction = 'plan' | 'apply' | 'undo' | 'unknown';
type Translate = (key: string, options?: Record<string, unknown>) => string;

interface ConfigUndoConfirmation {
  commitId: string;
  revision: number;
  changes: readonly ConfigValueChange[];
  affectedSections: readonly SettingsSectionRef[];
  requiresConfirmation: boolean;
}

interface SettingsChangeDisplayChange {
  settingId: string;
  before: ConfigStoredValue;
  after: ConfigStoredValue;
  risk?: SettingRisk;
  applyStrategy: SettingApplyStrategy;
}

interface SettingsChangePayload {
  action: SettingsChangeAction;
  changes: readonly SettingsChangeDisplayChange[];
  affectedSections: readonly SettingsSectionRef[];
  warnings: readonly ConfigPlanWarning[];
  commit: ConfigCommit | null;
  hasAuthoritativeConfirmationPreview: boolean;
  previewUnavailable: boolean;
}

interface SettingsChangeSectionGroup {
  key: string;
  tabId: string | null;
  sectionId: string | null;
  changes: Array<{
    change: SettingsChangeDisplayChange;
    descriptor?: SettingDescriptor;
  }>;
}

const KNOWN_ERROR_CODES = [
  'config.manual_draft_conflict',
  'config.revision_conflict',
  'config.catalog_changed',
  'config.plan_expired',
  'config.confirmation_required',
  'config.idempotency_conflict',
  'config.undo_conflict',
  'config.undo_token_invalid',
  'config.commit_unknown',
  'config.apply_retry_failed',
  'config.scope_unsupported',
  'config.setting_unavailable',
  'config.setting_managed',
  'config.recovery_read_only',
  'ai.model_not_configured',
] as const;

function asRecord(value: unknown): JsonRecord | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonRecord
    : null;
}

function parseJsonValue(value: unknown): unknown {
  if (typeof value !== 'string') {
    return value;
  }
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function isStoredValue(value: unknown): value is ConfigStoredValue {
  const record = asRecord(value);
  return (record?.kind === 'value' && Object.prototype.hasOwnProperty.call(record, 'value')) || (
    record?.kind === 'secret'
    && typeof record.configured === 'boolean'
  );
}

function isApplyStrategy(value: unknown): value is SettingApplyStrategy {
  return value === 'reactive'
    || value === 'adapter'
    || value === 'restartRequired'
    || value === 'manualOnly';
}

function isRisk(value: unknown): value is SettingRisk {
  return value === 'safe' || value === 'elevated' || value === 'destructive';
}

function isSectionRef(value: unknown): value is SettingsSectionRef {
  const record = asRecord(value);
  return Boolean(
    record
    && typeof record.categoryId === 'string'
    && typeof record.tabId === 'string'
    && typeof record.sectionId === 'string'
    && Array.isArray(record.fieldIds),
  );
}

function isPlanChange(value: unknown): value is ConfigPlanChange {
  const record = asRecord(value);
  return Boolean(
    record
    && typeof record.settingId === 'string'
    && isStoredValue(record.before)
    && isStoredValue(record.after)
    && isRisk(record.risk)
    && isApplyStrategy(record.applyStrategy),
  );
}

function isValueChange(value: unknown): value is ConfigValueChange {
  const record = asRecord(value);
  return Boolean(
    record
    && typeof record.settingId === 'string'
    && isStoredValue(record.oldValue)
    && isStoredValue(record.newValue)
    && isApplyStrategy(record.applyStrategy),
  );
}

function isPlanWarning(value: unknown): value is ConfigPlanWarning {
  const record = asRecord(value);
  return Boolean(record && typeof record.code === 'string');
}

function isConfigPlan(value: unknown): value is ConfigPlan {
  const record = asRecord(value);
  return Boolean(
    record
    && typeof record.planId === 'string'
    && typeof record.baseRevision === 'number'
    && typeof record.catalogVersion === 'string'
    && Array.isArray(record.changes)
    && record.changes.every(isPlanChange)
    && Array.isArray(record.affectedSections)
    && record.affectedSections.every(isSectionRef)
    && Array.isArray(record.warnings)
    && record.warnings.every(isPlanWarning),
  );
}

function isApplyReceiptStatus(value: unknown): value is ConfigApplyReceiptStatus {
  return value === 'pending'
    || value === 'applied'
    || value === 'restartRequired'
    || value === 'failed'
    || value === 'superseded'
    || value === 'rolledBack';
}

function isApplyReceipt(value: unknown): value is ConfigApplyReceipt {
  const record = asRecord(value);
  return Boolean(
    record
    && typeof record.consumer === 'string'
    && Array.isArray(record.settingIds)
    && record.settingIds.every((settingId) => typeof settingId === 'string')
    && typeof record.attempt === 'number'
    && typeof record.attemptedAt === 'string'
    && isApplyReceiptStatus(record.status)
    && typeof record.critical === 'boolean',
  );
}

function isConfigCommit(value: unknown): value is ConfigCommit {
  const record = asRecord(value);
  return Boolean(
    record
    && typeof record.commitId === 'string'
    && typeof record.revision === 'number'
    && (record.status === 'applying'
      || record.status === 'applied'
      || record.status === 'partial'
      || record.status === 'rolledBack')
    && Array.isArray(record.changes)
    && record.changes.every(isValueChange)
    && Array.isArray(record.applyReceipts)
    && record.applyReceipts.every(isApplyReceipt)
    && Array.isArray(record.affectedSections)
    && record.affectedSections.every(isSectionRef)
    && Array.isArray(record.restartRequired)
    && record.restartRequired.every((settingId) => typeof settingId === 'string')
    && (record.undoToken === null || typeof record.undoToken === 'string')
    && typeof record.committedAt === 'string',
  );
}

function isUndoConfirmation(value: unknown): value is ConfigUndoConfirmation {
  const record = asRecord(value);
  return Boolean(
    record
    && typeof record.commitId === 'string'
    && typeof record.revision === 'number'
    && Array.isArray(record.changes)
    && record.changes.every(isValueChange)
    && Array.isArray(record.affectedSections)
    && record.affectedSections.every(isSectionRef)
    && typeof record.requiresConfirmation === 'boolean',
  );
}

function findRecord<T>(
  value: unknown,
  predicate: (candidate: unknown) => candidate is T,
  depth = 0,
): T | null {
  const parsed = parseJsonValue(value);
  if (predicate(parsed)) {
    return parsed;
  }
  if (depth >= 3) {
    return null;
  }
  const record = asRecord(parsed);
  if (!record) {
    return null;
  }
  for (const nested of Object.values(record)) {
    const found = findRecord(nested, predicate, depth + 1);
    if (found) {
      return found;
    }
  }
  return null;
}

function normalizeAction(input: JsonRecord | null): SettingsChangeAction {
  const action = input?.action;
  return action === 'plan' || action === 'apply' || action === 'undo'
    ? action
    : 'unknown';
}

function planChanges(plan: ConfigPlan): SettingsChangeDisplayChange[] {
  return plan.changes.map((change) => ({
    settingId: change.settingId,
    before: change.before,
    after: change.after,
    risk: change.risk,
    applyStrategy: change.applyStrategy,
  }));
}

function commitChanges(commit: ConfigCommit): SettingsChangeDisplayChange[] {
  return commit.changes.map((change) => ({
    settingId: change.settingId,
    before: change.oldValue,
    after: change.newValue,
    applyStrategy: change.applyStrategy,
  }));
}

function undoPreviewChanges(confirmation: ConfigUndoConfirmation): SettingsChangeDisplayChange[] {
  return confirmation.changes.map((change) => ({
    settingId: change.settingId,
    before: change.newValue,
    after: change.oldValue,
    applyStrategy: change.applyStrategy,
  }));
}

function normalizeSettingsChangePayload(
  rawInput: unknown,
  rawResult: unknown,
): SettingsChangePayload {
  const parsedInput = parseJsonValue(rawInput);
  const input = asRecord(parsedInput);
  let action = normalizeAction(input);
  const commit = findRecord(rawResult, isConfigCommit);
  const plan = findRecord(rawResult, isConfigPlan)
    ?? findRecord(input?.plan, isConfigPlan);
  const undoConfirmation = findRecord(input?.confirmation, isUndoConfirmation);

  if (action === 'unknown') {
    if (undoConfirmation) action = 'undo';
    else if (plan) action = commit ? 'apply' : 'plan';
  }

  if (commit) {
    return {
      action,
      changes: commitChanges(commit),
      affectedSections: commit.affectedSections,
      warnings: [],
      commit,
      hasAuthoritativeConfirmationPreview: true,
      previewUnavailable: false,
    };
  }

  if (action === 'undo' && undoConfirmation) {
    return {
      action,
      changes: undoPreviewChanges(undoConfirmation),
      affectedSections: undoConfirmation.affectedSections,
      warnings: [],
      commit: null,
      hasAuthoritativeConfirmationPreview: undoConfirmation.changes.length > 0,
      previewUnavailable: false,
    };
  }

  if (plan) {
    return {
      action,
      changes: planChanges(plan),
      affectedSections: plan.affectedSections,
      warnings: plan.warnings,
      commit: null,
      hasAuthoritativeConfirmationPreview: plan.changes.length > 0,
      previewUnavailable: false,
    };
  }

  const previewUnavailable = input?.unavailable === true;
  return {
    action,
    changes: [],
    affectedSections: [],
    warnings: [],
    commit: null,
    hasAuthoritativeConfirmationPreview: false,
    previewUnavailable,
  };
}

function humanizeSettingId(settingId: string): string {
  const segments = settingId.split('.').filter(Boolean);
  const relevant = segments.slice(-2).join(' ');
  return relevant
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\w/, (character) => character.toUpperCase()) || settingId;
}

function truncateValue(value: string, maxLength = 160): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, maxLength - 1).trimEnd()}…`;
}

function resolveEnumLabel(
  descriptor: SettingDescriptor | undefined,
  value: unknown,
): string | null {
  if ((typeof value !== 'string' && typeof value !== 'number') || !descriptor?.resolvedOptions) {
    return null;
  }
  return descriptor.resolvedOptions.find((option) => option.value === String(value))?.label ?? null;
}

function formatPublicValue(
  value: unknown,
  descriptor: SettingDescriptor | undefined,
  t: Translate,
): string {
  const optionLabel = resolveEnumLabel(descriptor, value);
  if (optionLabel) return optionLabel;
  if (value === null) return t('toolCards.settingsChange.values.notSet');
  if (value === true) return t('toolCards.settingsChange.values.enabled');
  if (value === false) return t('toolCards.settingsChange.values.disabled');
  if (typeof value === 'string') {
    return value ? truncateValue(value) : t('toolCards.settingsChange.values.empty');
  }
  if (typeof value === 'number') return String(value);
  try {
    const serialized = JSON.stringify(value);
    return typeof serialized === 'string'
      ? truncateValue(serialized)
      : t('toolCards.settingsChange.values.updated');
  } catch {
    return t('toolCards.settingsChange.values.updated');
  }
}

function formatChangeValues(
  change: SettingsChangeDisplayChange,
  descriptor: SettingDescriptor | undefined,
  t: Translate,
): { before: string; after: string } {
  if (change.before.kind === 'secret' || change.after.kind === 'secret') {
    const beforeConfigured = change.before.kind === 'secret' && change.before.configured;
    const afterConfigured = change.after.kind === 'secret' && change.after.configured;
    return {
      before: beforeConfigured
        ? t('toolCards.settingsChange.secret.configured')
        : t('toolCards.settingsChange.secret.unconfigured'),
      after: afterConfigured
        ? (beforeConfigured
          ? t('toolCards.settingsChange.secret.willUpdate')
          : t('toolCards.settingsChange.secret.configured'))
        : t('toolCards.settingsChange.secret.unconfigured'),
    };
  }

  return {
    before: formatPublicValue(change.before.value, descriptor, t),
    after: formatPublicValue(change.after.value, descriptor, t),
  };
}

function safeErrorCode(error: unknown): string {
  if (typeof error !== 'string') {
    return 'config.operation_failed';
  }
  return KNOWN_ERROR_CODES.find((code) => error.includes(code)) ?? 'config.operation_failed';
}

function formatTimestamp(value: string | number | null | undefined, locale: string): string {
  if (value === null || value === undefined || value === '') return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat(locale, {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date);
}

function toolTimestamp(toolItem: ToolCardProps['toolItem']): number | null {
  const value = toolItem.endTime ?? toolItem.startTime ?? toolItem.timestamp;
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

function receiptStatusForSetting(
  commit: ConfigCommit | null,
  settingId: string,
): ConfigApplyReceiptStatus | null {
  if (!commit) return null;
  const statuses = commit.applyReceipts
    .filter((receipt) => receipt.settingIds.includes(settingId))
    .map((receipt) => receipt.status);
  const priority: ConfigApplyReceiptStatus[] = [
    'failed',
    'rolledBack',
    'restartRequired',
    'pending',
    'superseded',
    'applied',
  ];
  return priority.find((status) => statuses.includes(status)) ?? null;
}

function effectLabel(
  t: Translate,
  change: SettingsChangeDisplayChange,
  commit: ConfigCommit | null,
): string {
  if (commit?.restartRequired.includes(change.settingId)) {
    return t('toolCards.settingsChange.effects.restartRequired');
  }
  const receiptStatus = receiptStatusForSetting(commit, change.settingId);
  if (receiptStatus) {
    return t(`toolCards.settingsChange.receipts.${receiptStatus}`);
  }
  return t(`toolCards.settingsChange.effects.${change.applyStrategy}`);
}

function summaryLabel(
  t: Translate,
  action: SettingsChangeAction,
  phase: ToolPresentationPhase,
  payload: SettingsChangePayload,
): string {
  const count = payload.changes.length;
  if (phase === 'error') {
    return t(`toolCards.settingsChange.status.${action}.failed`);
  }
  if (phase === 'cancelled' || phase === 'interrupted') {
    return t(`toolCards.settingsChange.status.${action}.cancelled`);
  }
  if (phase === 'confirming') {
    return t(`toolCards.settingsChange.status.${action}.confirming`, { count });
  }
  if (phase === 'preparing' || phase === 'receiving_input' || phase === 'ready' || phase === 'running') {
    return t(`toolCards.settingsChange.status.${action}.running`, { count });
  }

  if (payload.commit?.status === 'rolledBack') {
    return t('toolCards.settingsChange.status.result.rolledBack', { count });
  }
  if (payload.commit?.status === 'partial') {
    return t('toolCards.settingsChange.status.result.partial', { count });
  }
  if (payload.commit?.status === 'applying') {
    return t('toolCards.settingsChange.status.result.applying', { count });
  }
  if (payload.commit?.restartRequired.length) {
    return t('toolCards.settingsChange.status.result.restartRequired', {
      count,
      restartCount: payload.commit.restartRequired.length,
    });
  }
  return t(`toolCards.settingsChange.status.${action}.completed`, { count });
}

function cardStatus(phase: ToolPresentationPhase): 'pending' | 'running' | 'completed' | 'error' {
  if (phase === 'error') return 'error';
  if (phase === 'result' || phase === 'cancelled' || phase === 'interrupted') return 'completed';
  if (phase === 'running' || phase === 'receiving_input') return 'running';
  return 'pending';
}

function cardTone(
  phase: ToolPresentationPhase,
  payload: SettingsChangePayload,
): 'neutral' | 'info' | 'success' | 'warning' | 'danger' {
  if (phase === 'error') return 'danger';
  if (
    payload.commit?.status === 'partial'
    || (phase === 'confirming' && payload.changes.some((change) => change.risk === 'elevated'))
  ) return 'warning';
  if (payload.commit?.status === 'rolledBack' && payload.action !== 'undo') return 'warning';
  if (payload.commit?.restartRequired.length) return 'warning';
  if (phase === 'result') return payload.action === 'plan' ? 'info' : 'success';
  if (phase === 'cancelled' || phase === 'interrupted') return 'neutral';
  return 'neutral';
}

function SettingsChangeRow({
  change,
  descriptor,
  commit,
  showEffect,
  onOpenManual,
  title,
  description,
  t,
}: {
  change: SettingsChangeDisplayChange;
  descriptor?: SettingDescriptor;
  commit: ConfigCommit | null;
  showEffect: boolean;
  onOpenManual?: () => void;
  title: string;
  description?: string;
  t: Translate;
}) {
  const values = formatChangeValues(change, descriptor, t);
  const receiptStatus = receiptStatusForSetting(commit, change.settingId);
  const effectTone = receiptStatus === 'failed'
    ? 'is-danger'
    : commit?.restartRequired.includes(change.settingId)
      || receiptStatus === 'restartRequired'
      || receiptStatus === 'rolledBack'
      || change.applyStrategy === 'restartRequired'
      ? 'is-warning'
      : '';
  const controlId = `settings-change-${change.settingId.replace(/[^a-zA-Z0-9_-]/g, '-')}`;
  return (
    <li
      className="settings-change-preview-card__change"
      data-setting-control={descriptor?.presentation.control ?? 'unknown'}
    >
      <FormField
        controlId={controlId}
        label={title}
        description={description}
        orientation="horizontal"
        controlWidth="balanced"
      >
        <div id={controlId} className="settings-change-preview-card__change-control">
          <div className="settings-change-preview-card__value-journey">
            <span className="settings-change-preview-card__value-phase is-before">
              <span className="settings-change-preview-card__value-label">
                {t('toolCards.settingsChange.comparison.before')}
              </span>
              <span className="settings-change-preview-card__value">{values.before}</span>
            </span>
            <span className="settings-change-preview-card__value-phase is-after">
              <span className="settings-change-preview-card__value-label">
                {t('toolCards.settingsChange.comparison.after')}
              </span>
              <span className="settings-change-preview-card__value">{values.after}</span>
            </span>
          </div>
          {onOpenManual ? (
            <IconButton
              variant="ghost"
              size="small"
              className="settings-change-preview-card__item-manual"
              aria-label={t('toolCards.settingsChange.actions.viewManual')}
              tooltip={t('toolCards.settingsChange.actions.viewManual')}
              onClick={onOpenManual}
            >
              <ExternalLink size={14} strokeWidth={1.8} aria-hidden="true" />
            </IconButton>
          ) : null}
          <div className="settings-change-preview-card__semantics">
            {showEffect ? (
              <span className={`settings-change-preview-card__effect-text ${effectTone}`.trim()}>
                {effectLabel(t, change, commit)}
              </span>
            ) : null}
            {change.risk === 'elevated' ? (
              <span className="settings-change-preview-card__risk-text is-warning">
                {t('toolCards.settingsChange.risks.elevated')}
              </span>
            ) : null}
            {change.risk === 'destructive' ? (
              <span className="settings-change-preview-card__risk-text is-danger">
                {t('toolCards.settingsChange.risks.destructive')}
              </span>
            ) : null}
          </div>
        </div>
      </FormField>
    </li>
  );
}

export const SettingsChangePreviewCard: React.FC<ToolCardProps> = ({
  toolItem,
  onConfirm,
  onReject,
  mutationsDisabled = false,
}) => {
  const { t, i18n } = useTranslation('flow-chat');
  const catalogState = useSyncExternalStore(
    configCatalogStore.subscribe,
    configCatalogStore.getState,
    configCatalogStore.getState,
  );
  const viewState = useMemo(() => getToolViewState(toolItem), [toolItem]);
  const payload = useMemo(
    () => normalizeSettingsChangePayload(toolItem.toolCall?.input, toolItem.toolResult?.result),
    [toolItem.toolCall?.input, toolItem.toolResult?.result],
  );
  const [undoState, setUndoState] = useState<'idle' | 'running' | 'done' | 'error'>('idle');
  const [undoErrorCode, setUndoErrorCode] = useState<string | null>(null);
  const [undoCompletedAt, setUndoCompletedAt] = useState<string | null>(null);

  useEffect(() => {
    if (catalogState.status === 'idle') {
      void configCatalogStore.load().catch(() => undefined);
    }
  }, [catalogState.status]);

  useEffect(() => {
    setUndoState('idle');
    setUndoErrorCode(null);
    setUndoCompletedAt(null);
  }, [payload.commit?.commitId]);

  const settingTitle = (settingId: string): string => {
    const descriptor = configCatalogStore.getDescriptor(settingId);
    const fallback = humanizeSettingId(settingId);
    return descriptor
      ? String(i18n.t(descriptor.presentation.titleKey, { defaultValue: fallback }))
      : fallback;
  };

  const settingDescription = (descriptor: SettingDescriptor | undefined): string | undefined => {
    const descriptionKey = descriptor?.presentation.descriptionKey;
    if (!descriptionKey) return undefined;
    const description = String(i18n.t(descriptionKey, { defaultValue: '' })).trim();
    return description || undefined;
  };

  const sectionTitle = (tabId: string | null, sectionId: string | null): string => {
    if (!tabId && !sectionId) {
      return t('toolCards.settingsChange.sectionFallback');
    }
    return String(i18n.t(`settings/config-center:tabs.${tabId ?? ''}`, {
      defaultValue: humanizeSettingId(sectionId ?? tabId ?? ''),
    }));
  };

  const sectionGroups: SettingsChangeSectionGroup[] = (() => {
    const groups = new Map<string, SettingsChangeSectionGroup>();
    for (const change of payload.changes) {
      const descriptor = configCatalogStore.getDescriptor(change.settingId);
      const presentation = descriptor?.presentation;
      const key = presentation
        ? `${presentation.tabId}:${presentation.sectionId}`
        : '__unclassified__';
      const group = groups.get(key) ?? {
        key,
        tabId: presentation?.tabId ?? null,
        sectionId: presentation?.sectionId ?? null,
        changes: [],
      };
      group.changes.push({ change, descriptor });
      groups.set(key, group);
    }
    return [...groups.values()];
  })();

  const isConfirmation = viewState.phase === 'confirming';
  const canConfirmSafely = isConfirmation && payload.hasAuthoritativeConfirmationPreview;
  const hasFooter = Boolean(isConfirmation && (onConfirm || onReject));
  const showUnavailable = isConfirmation
    && (!payload.hasAuthoritativeConfirmationPreview || payload.previewUnavailable);
  const errorMessage = viewState.phase === 'error'
    ? t(`toolCards.settingsChange.errors.${safeErrorCode(toolItem.toolResult?.error)}`)
    : null;
  const hasBodyContent = payload.changes.length > 0
    || payload.warnings.length > 0
    || showUnavailable
    || payload.commit?.status === 'partial'
    || Boolean(errorMessage);

  const effectLabels = Array.from(new Set(
    payload.changes.map((change) => effectLabel(t, change, payload.commit)),
  ));
  const headerEffect = effectLabels.length === 1
    ? effectLabels[0]
    : effectLabels.length > 1
      ? t('toolCards.settingsChange.effects.mixed')
      : null;
  const showRowEffect = effectLabels.length > 1;
  const compactReceipt = viewState.phase === 'result'
    && payload.action === 'apply'
    && payload.commit?.status === 'applied'
    && payload.commit.restartRequired.length === 0;
  const canUndo = compactReceipt
    && typeof payload.commit?.undoToken === 'string'
    && payload.commit.undoToken.length > 0
    && undoState !== 'done';
  const receiptTimestamp = formatTimestamp(
    undoCompletedAt ?? payload.commit?.committedAt ?? toolTimestamp(toolItem),
    i18n.language,
  );
  const summary = summaryLabel(t, payload.action, viewState.phase, payload);

  const handleUndo = useCallback(async () => {
    const commit = payload.commit;
    if (
      mutationsDisabled
      || undoState === 'running'
      || !commit
      || typeof commit.undoToken !== 'string'
      || !commit.undoToken
    ) return;

    setUndoState('running');
    setUndoErrorCode(null);
    try {
      const snapshot = await configSnapshotStore.refresh();
      const rollback = await configAPI.undoConfigCommit({
        commitId: commit.commitId,
        undoToken: commit.undoToken,
        expectedRevision: snapshot.revision,
        idempotencyKey: `settings-card-undo-${commit.commitId}-${snapshot.revision}`,
        confirmed: true,
      });
      setUndoCompletedAt(rollback.committedAt);
      setUndoState('done');
      if ((configSnapshotStore.getState().snapshot?.revision ?? -1) < rollback.revision) {
        await configSnapshotStore.refresh();
      }
    } catch (error) {
      setUndoErrorCode(safeErrorCode(error instanceof Error ? error.message : error));
      setUndoState('error');
    }
  }, [mutationsDisabled, payload.commit, undoState]);

  if (compactReceipt) {
    const receiptLabel = undoState === 'done'
      ? t('toolCards.settingsChange.status.result.undone', { count: payload.changes.length })
      : summary;
    const undoError = undoErrorCode
      ? t(`toolCards.settingsChange.errors.${undoErrorCode}`)
      : null;

    return (
      <div
        className="settings-change-receipt"
        data-undo-state={undoState}
        data-testid="settings-change-receipt"
      >
        <CompactToolCard
          status="completed"
          className="settings-change-receipt__card"
          header={(
            <ToolCompactHeaderLayout
              status="completed"
              action={(
                <span className="settings-change-receipt__summary" role="status" aria-live="polite">
                  {receiptLabel}
                </span>
              )}
              extra={(receiptTimestamp || canUndo) ? (
                <span className="settings-change-receipt__meta">
                  {receiptTimestamp ? (
                    <time className="settings-change-receipt__time">{receiptTimestamp}</time>
                  ) : null}
                  {canUndo ? (
                    <IconButton
                      variant="default"
                      size="small"
                      className="settings-change-receipt__undo"
                      disabled={mutationsDisabled || undoState === 'running'}
                      isLoading={undoState === 'running'}
                      aria-label={t(undoState === 'running'
                        ? 'toolCards.settingsChange.actions.undoing'
                        : 'toolCards.settingsChange.actions.undo')}
                      tooltip={t('toolCards.settingsChange.actions.undo')}
                      onClick={() => void handleUndo()}
                    >
                      <RotateCcw size={14} strokeWidth={1.9} aria-hidden="true" />
                    </IconButton>
                  ) : null}
                </span>
              ) : null}
            />
          )}
        />
        {undoError ? (
          <span className="settings-change-receipt__error" role="alert">{undoError}</span>
        ) : null}
      </div>
    );
  }

  return (
    <ToolCard
      status={cardStatus(viewState.phase)}
      tone={cardTone(viewState.phase, payload)}
      className={[
        'settings-change-preview-card',
        isConfirmation && 'is-confirming',
      ].filter(Boolean).join(' ')}
      data-action={payload.action}
      data-testid="settings-change-preview-card"
    >
      <ToolCardHeader
        title={(
          <span className="settings-change-preview-card__header-copy">
            <span className="settings-change-preview-card__title">
              {t('toolCards.settingsChange.title')}
            </span>
            <span className="settings-change-preview-card__summary" role="status" aria-live="polite">
              {summary}
            </span>
          </span>
        )}
        actions={headerEffect ? (
          <span className="settings-change-preview-card__header-effect">{headerEffect}</span>
        ) : null}
      />

      {hasBodyContent && (
        <ToolCardBody>
          {payload.changes.length > 0 ? (
            <div className="settings-change-preview-card__sections">
              {sectionGroups.map((group) => (
                <section
                  key={group.key}
                  className="settings-change-preview-card__section"
                  data-setting-section={group.sectionId ?? undefined}
                >
                  <header className="settings-change-preview-card__section-header">
                    <h3 className="settings-change-preview-card__section-title">
                      {sectionTitle(group.tabId, group.sectionId)}
                    </h3>
                    <span className="settings-change-preview-card__section-count">
                      {t('toolCards.settingsChange.sectionChangeCount', {
                        count: group.changes.length,
                      })}
                    </span>
                  </header>
                  <ol className="settings-change-preview-card__changes">
                    {group.changes.map(({ change, descriptor }) => (
                      <SettingsChangeRow
                        key={change.settingId}
                        change={change}
                        descriptor={descriptor}
                        commit={payload.commit}
                        showEffect={showRowEffect}
                        onOpenManual={descriptor ? () => {
                          useSettingsStore.getState().openManualLocation({
                            tabId: descriptor.presentation.tabId,
                            sectionId: descriptor.presentation.sectionId,
                            fieldId: descriptor.presentation.fieldId,
                          });
                        } : undefined}
                        title={settingTitle(change.settingId)}
                        description={settingDescription(descriptor)}
                        t={t}
                      />
                    ))}
                  </ol>
                </section>
              ))}
            </div>
          ) : null}

          {payload.warnings.length > 0 ? (
            <p className="settings-change-preview-card__notice is-warning" role="note">
              {t('toolCards.settingsChange.warningCount', { count: payload.warnings.length })}
            </p>
          ) : null}

          {showUnavailable ? (
            <p className="settings-change-preview-card__notice is-warning" role="alert">
              {t('toolCards.settingsChange.previewUnavailable')}
            </p>
          ) : null}

          {payload.commit?.status === 'partial' ? (
            <p className="settings-change-preview-card__notice is-warning" role="note">
              {t('toolCards.settingsChange.partialNotice')}
            </p>
          ) : null}

          {errorMessage ? (
            <p className="settings-change-preview-card__notice is-error" role="alert">
              {errorMessage}
            </p>
          ) : null}
        </ToolCardBody>
      )}

      {hasFooter ? (
        <ToolCardFooter className="settings-change-preview-card__footer">
          {isConfirmation && onReject ? (
            <Button
              variant="secondary"
              size="small"
              disabled={mutationsDisabled}
              onClick={onReject}
            >
              {t('toolCards.settingsChange.actions.cancel')}
            </Button>
          ) : null}
          {isConfirmation && onConfirm ? (
            <Button
              variant="primary"
              size="small"
              disabled={mutationsDisabled || !canConfirmSafely}
              onClick={() => onConfirm()}
            >
              {t(`toolCards.settingsChange.actions.confirm.${payload.action}`)}
            </Button>
          ) : null}
        </ToolCardFooter>
      ) : null}
    </ToolCard>
  );
};

SettingsChangePreviewCard.displayName = 'SettingsChangePreviewCard';
