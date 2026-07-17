/**
 * FlowChat Module Exports
 */

export { ModernFlowChatContainer as FlowChatContainer } from './components/modern/ModernFlowChatContainer';

// Other components
export { ChatInput } from './components/ChatInput';
export { FlowChatSessionSurface } from './components/FlowChatSessionSurface';
export type { FlowChatSessionSurfaceProps } from './components/FlowChatSessionSurface';
export { CurrentSessionTitle } from './components/CurrentSessionTitle';
export { ScrollToLatestBar } from './components/ScrollToLatestBar';

// Services and Stores
export { FlowChatManager } from './services/FlowChatManager';

// State machine
export { stateMachineManager } from './state-machine';
export type { TodoItem } from './state-machine/types';
