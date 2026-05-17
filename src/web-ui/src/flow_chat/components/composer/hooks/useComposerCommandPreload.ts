import { useEffect } from 'react';

export function useComposerCommandPreload({
  isProcessing,
  loadMcpPromptCommands,
  slashKind,
  slashPickerOpen,
}: {
  isProcessing?: boolean;
  loadMcpPromptCommands: () => Promise<void>;
  slashKind: string;
  slashPickerOpen: boolean;
}) {
  useEffect(() => {
    if (!slashPickerOpen || slashKind !== 'all' || isProcessing) {
      return;
    }

    void loadMcpPromptCommands();
  }, [isProcessing, loadMcpPromptCommands, slashKind, slashPickerOpen]);
}
