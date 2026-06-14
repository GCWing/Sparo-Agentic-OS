import React, { createContext, useContext } from 'react';

const ToolInterruptionNoteContext = createContext<string | null>(null);

export const ToolInterruptionNoteProvider = ToolInterruptionNoteContext.Provider;

export function useToolInterruptionNote(): string | null {
  return useContext(ToolInterruptionNoteContext);
}

export function ToolInlineInterruptionNote({
  note,
  subject,
}: {
  note: string;
  subject?: React.ReactNode;
}): React.ReactElement {
  return (
    <span className="tool-card-interruption-inline">
      {subject && (
        <span className="tool-card-interruption-subject">
          {subject}
        </span>
      )}
      <span className="tool-card-interruption-note" title={note}>
        {note}
      </span>
    </span>
  );
}
