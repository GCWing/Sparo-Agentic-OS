import { Eye, EyeOff, Table2, TriangleAlert } from 'lucide-react';
import { IconButton } from '@/design-system';
import {
  isSpreadsheetFocusBoundToSession,
  spreadsheetFormulaResultsTrustworthy,
  useExcelLiveFocusStore,
} from '@/app/agentic-os/excel-live/excelLiveFocusStore';

interface ComposerSpreadsheetFocusRailProps {
  sessionId: string | null | undefined;
  labels: {
    included: string;
    excluded: string;
    includeAction: string;
    excludeAction: string;
    partialCache: string;
    staleFormulas: string;
    modes: {
      inspect: string;
      edit: string;
      author: string;
    };
  };
}

export function ComposerSpreadsheetFocusRail({
  sessionId,
  labels,
}: ComposerSpreadsheetFocusRailProps) {
  const ambient = useExcelLiveFocusStore(state => (
    sessionId ? state.ambientBySessionId[sessionId] ?? null : null
  ));
  const includeOnSend = useExcelLiveFocusStore(state => state.includeOnSend);
  const setIncludeOnSend = useExcelLiveFocusStore(state => state.setIncludeOnSend);

  if (!ambient || !isSpreadsheetFocusBoundToSession(ambient, sessionId)) {
    return null;
  }

  const selectionLabel = `${ambient.sheetName}!${ambient.a1}`;
  const formulaTrustworthy = spreadsheetFormulaResultsTrustworthy(ambient);
  const modeLabel = ambient.mode ? labels.modes[ambient.mode] : null;
  const revisionLabel = ambient.revision === undefined
    ? null
    : `r${String(ambient.revision)}`;
  const stateLabel = includeOnSend ? labels.included : labels.excluded;
  const actionLabel = includeOnSend ? labels.excludeAction : labels.includeAction;
  const accessibleLabel = [
    stateLabel,
    selectionLabel,
    modeLabel,
    revisionLabel,
    ambient.cacheComplete === true ? null : labels.partialCache,
    !formulaTrustworthy ? labels.staleFormulas : null,
    actionLabel,
  ].filter(Boolean).join(', ');

  return (
    <div
      className="sparo-chat-input__intent-chips sparo-chat-input__spreadsheet-focus-rail"
      aria-live="polite"
    >
      <span
        aria-label={[stateLabel, selectionLabel, modeLabel, revisionLabel].filter(Boolean).join(', ')}
        className={`sparo-chat-input__intent-chip sparo-chat-input__intent-chip--target sparo-chat-input__spreadsheet-focus${includeOnSend ? '' : ' sparo-chat-input__spreadsheet-focus--excluded'}`}
        role="status"
      >
        <Table2 size={13} aria-hidden />
        <span className="sparo-chat-input__spreadsheet-focus-selection">{selectionLabel}</span>
        {(modeLabel || revisionLabel) && (
          <span className="sparo-chat-input__spreadsheet-focus-meta">
            {[modeLabel, revisionLabel].filter(Boolean).join(' · ')}
          </span>
        )}
        {(ambient.cacheComplete !== true || !formulaTrustworthy) && (
          <TriangleAlert
            aria-label={!formulaTrustworthy ? labels.staleFormulas : labels.partialCache}
            className="sparo-chat-input__spreadsheet-focus-warning"
            size={12}
          />
        )}
      </span>
      <IconButton
        aria-label={accessibleLabel}
        aria-pressed={includeOnSend}
        className="sparo-chat-input__intent-icon sparo-chat-input__intent-icon--target"
        onClick={() => setIncludeOnSend(!includeOnSend)}
        size="xs"
        tooltip={actionLabel}
        variant="ghost"
      >
        {includeOnSend
          ? <Eye size={12} aria-hidden />
          : <EyeOff size={12} aria-hidden />}
      </IconButton>
    </div>
  );
}
