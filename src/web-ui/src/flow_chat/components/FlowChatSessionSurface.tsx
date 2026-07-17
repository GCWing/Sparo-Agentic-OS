import { SessionProfileScope } from '@/app/session-profiles';
import type { SessionProfileId } from '../domain/sessionDescriptor';
import type { ResolveMessageSendContext } from '../hooks/useMessageSender';
import { ChatInput } from './ChatInput';
import { ModernFlowChatContainer } from './modern/ModernFlowChatContainer';
import './FlowChatSessionSurface.scss';

export interface FlowChatSessionSurfaceProps {
  sessionId: string;
  profileId: SessionProfileId;
  className?: string;
  active?: boolean;
  disabled?: boolean;
  resolveSendContext?: ResolveMessageSendContext;
}

/**
 * Reusable embedded composition of the FlowChat transcript and composer.
 * The explicit profile keeps this surface independent from global session focus.
 */
export function FlowChatSessionSurface({
  sessionId,
  profileId,
  className = '',
  active = true,
  disabled = false,
  resolveSendContext,
}: FlowChatSessionSurfaceProps) {
  return (
    <SessionProfileScope profileId={profileId}>
      <div
        className={['flow-chat-session-surface', className].filter(Boolean).join(' ')}
        data-shortcut-scope="chat"
      >
        <ModernFlowChatContainer
          className="flow-chat-session-surface__transcript"
          sessionId={sessionId}
          active={active}
          presentation="embedded"
          mutationsDisabled={disabled}
          config={{
            enableMarkdown: true,
            autoScroll: true,
            showTimestamps: false,
            theme: 'auto',
          }}
        />
        <div
          ref={(element) => element?.toggleAttribute('inert', disabled)}
          className="flow-chat-session-surface__composer"
          aria-disabled={disabled}
        >
          <ChatInput
            key={sessionId}
            targetSessionId={sessionId}
            active={active && !disabled}
            resolveSendContext={resolveSendContext}
          />
        </div>
      </div>
    </SessionProfileScope>
  );
}
