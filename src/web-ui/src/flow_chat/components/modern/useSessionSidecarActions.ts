import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useCanvasStore } from '@/app/components/panels/content-canvas/stores';
import { openSessionSidecarPanel, useSessionProfile } from '@/app/session-profiles';
import { useProductAppRuntimeStore } from '@/app/scenes/apps/product-app-runtime/productAppRuntimeStore';
import type {
  SessionSidecarActionDescriptor,
  SessionSidecarIconId,
} from '@/app/session-profiles';
import { useActiveSession } from '../../store/modernFlowChatStore';

export interface FlowChatSidecarActionViewModel {
  id: string;
  label: string;
  icon: SessionSidecarIconId;
  disabled: boolean;
  isOpen: boolean;
  isActive: boolean;
  onOpen: () => void;
}

function getDuplicateCheckKey(action: SessionSidecarActionDescriptor): string | undefined {
  return action.panel.duplicateCheckKey ??
    (typeof action.panel.metadata?.duplicateCheckKey === 'string'
      ? action.panel.metadata.duplicateCheckKey
      : undefined);
}

export function useSessionSidecarActions(): FlowChatSidecarActionViewModel[] {
  const { t } = useTranslation('flow-chat');
  const { profile } = useSessionProfile();
  const activeSession = useActiveSession();
  const primaryGroup = useCanvasStore(state => state.primaryGroup);
  const secondaryGroup = useCanvasStore(state => state.secondaryGroup);
  const tertiaryGroup = useCanvasStore(state => state.tertiaryGroup);
  const storeBuilderAppId = useProductAppRuntimeStore(state =>
    activeSession?.sessionId ? state.sessionAppIds[activeSession.sessionId] : undefined
  );

  return useMemo(() => {
    if (!activeSession?.sessionId || !profile.sidecarActions) {
      return [];
    }

    const agentSessionBinding = activeSession.customMetadata?.agentSessionBinding;
    const builderAppId = agentSessionBinding?.subject.kind === 'product-app'
      ? agentSessionBinding.subject.id
      : storeBuilderAppId;

    const extra: Record<string, unknown> = {
      appId: builderAppId,
      tabTitle: 'App Builder',
      agentSessionBinding,
      customMetadata: activeSession.customMetadata,
      productAppRuntime: activeSession.customMetadata?.productAppRuntime,
      workspacePath: activeSession.workspacePath,
    };

    const descriptors = profile.sidecarActions(activeSession.sessionId, extra) ?? [];
    if (descriptors.length === 0) {
      return [];
    }

    const groups = [
      { groupId: 'primary', group: primaryGroup },
      { groupId: 'secondary', group: secondaryGroup },
      { groupId: 'tertiary', group: tertiaryGroup },
    ] as const;

    return [...descriptors]
      .filter(action => action.availability !== 'hidden')
      .sort((left, right) => (left.order ?? 0) - (right.order ?? 0))
      .map((action) => {
        const duplicateCheckKey = getDuplicateCheckKey(action);
        const matchingTab = duplicateCheckKey
          ? groups
              .flatMap(({ groupId, group }) =>
                group.tabs.map(tab => ({ groupId, group, tab }))
              )
              .find(({ tab }) =>
                tab.content.metadata?.duplicateCheckKey === duplicateCheckKey ||
                tab.content.metadata?.duplicateCheckKey === action.panel.metadata?.duplicateCheckKey
              )
          : null;
        const isActive = Boolean(
          matchingTab &&
          matchingTab.group.activeTabId === matchingTab.tab.id
        );
        const label =
          action.label ||
          (action.labelKey
            ? t(action.labelKey, { defaultValue: action.defaultLabel })
            : action.defaultLabel);

        return {
          id: action.id,
          label,
          icon: action.icon,
          disabled: action.availability === 'disabled',
          isOpen: Boolean(matchingTab),
          isActive,
          onOpen: () => openSessionSidecarPanel(action.panel),
        };
      });
  }, [
    activeSession?.customMetadata,
    activeSession?.sessionId,
    activeSession?.workspacePath,
    primaryGroup,
    profile,
    secondaryGroup,
    storeBuilderAppId,
    t,
    tertiaryGroup,
  ]);
}
