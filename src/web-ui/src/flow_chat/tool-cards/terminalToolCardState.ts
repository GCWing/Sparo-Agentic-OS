export type TerminalWaitingMessageKey =
  | 'toolCards.terminal.receivingParams'
  | 'toolCards.terminal.executingCommand';

export type TerminalDisplayPhase =
  | 'idle'
  | 'receiving_params'
  | 'executing'
  | 'live_output'
  | 'completed'
  | 'cancelled_output';

export interface TerminalViewState {
  isLoading: boolean;
  isFailed: boolean;
  showInterruptButton: boolean;
  showCompletedResult: boolean;
  showCancelledResult: boolean;
  hasHeaderExtra: boolean;
  statusLabel: 'rejected' | 'cancelled' | 'failed' | null;
  statusClassName: 'status-rejected' | 'status-cancelled' | 'status-error' | null;
  displayPhase: TerminalDisplayPhase;
  waitingMessageKey: TerminalWaitingMessageKey | null;
}

interface GetTerminalViewStateParams {
  lifecycle: ToolLifecycle;
  inputPhase: ToolInputPhase;
  presentationPhase: ToolPresentationPhase;
  liveOutput: string;
  interruptRequested: boolean;
  showConfirmButtons: boolean;
  wasInterrupted: boolean;
}

function deriveDisplayPhase(params: {
  lifecycle: ToolLifecycle;
  inputPhase: ToolInputPhase;
  presentationPhase: ToolPresentationPhase;
  liveOutput: string;
}): Pick<TerminalViewState, 'displayPhase' | 'waitingMessageKey'> {
  const { lifecycle, inputPhase, presentationPhase, liveOutput } = params;
  const hasLiveOutput = liveOutput.length > 0;

  if (lifecycle === 'completed') {
    return {
      displayPhase: 'completed',
      waitingMessageKey: null,
    };
  }

  if (lifecycle === 'cancelled' && hasLiveOutput) {
    return {
      displayPhase: 'cancelled_output',
      waitingMessageKey: null,
    };
  }

  if (hasLiveOutput && (presentationPhase === 'receiving_input' || presentationPhase === 'running')) {
    return {
      displayPhase: 'live_output',
      waitingMessageKey: null,
    };
  }

  if (inputPhase === 'streaming') {
    return {
      displayPhase: 'receiving_params',
      waitingMessageKey: 'toolCards.terminal.receivingParams',
    };
  }

  if (presentationPhase === 'running' || presentationPhase === 'ready') {
    return {
      displayPhase: 'executing',
      waitingMessageKey: 'toolCards.terminal.executingCommand',
    };
  }

  return {
    displayPhase: 'idle',
    waitingMessageKey: null,
  };
}

export function getTerminalViewState(
  params: GetTerminalViewStateParams,
): TerminalViewState {
  const {
    lifecycle,
    inputPhase,
    presentationPhase,
    liveOutput,
    interruptRequested,
    showConfirmButtons,
    wasInterrupted,
  } = params;
  const isRunning = presentationPhase === 'running';
  const isLoading =
    presentationPhase === 'preparing' ||
    presentationPhase === 'receiving_input' ||
    presentationPhase === 'ready' ||
    presentationPhase === 'running';
  const showInterruptButton = isRunning && !interruptRequested;

  let statusLabel: TerminalViewState['statusLabel'] = null;
  let statusClassName: TerminalViewState['statusClassName'] = null;

  if ((interruptRequested && isRunning) || wasInterrupted || presentationPhase === 'cancelled' || presentationPhase === 'interrupted') {
    statusLabel = 'cancelled';
    statusClassName = 'status-cancelled';
  } else if (presentationPhase === 'error') {
    statusLabel = 'failed';
    statusClassName = 'status-error';
  }

  const { displayPhase, waitingMessageKey } = deriveDisplayPhase({
    lifecycle,
    inputPhase,
    presentationPhase,
    liveOutput,
  });

  return {
    isLoading,
    isFailed: presentationPhase === 'error',
    showInterruptButton,
    showCompletedResult: displayPhase === 'completed',
    showCancelledResult: displayPhase === 'cancelled_output',
    hasHeaderExtra: Boolean(statusLabel || showConfirmButtons || showInterruptButton),
    statusLabel,
    statusClassName,
    displayPhase,
    waitingMessageKey,
  };
}
import type { ToolInputPhase, ToolLifecycle } from '../runtime/statusModel';
import type { ToolPresentationPhase } from '../runtime/toolViewState';
