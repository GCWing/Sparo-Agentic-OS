/**
 * Application manager.
 * Manages global layout and app state across modes.
 */

import {
  IAppManager,
  AppState,
  AppEvent,
  LayoutState,
  AgentConfig,
  ChatSession,
  ChatMessage,
  DEFAULT_LAYOUT_STATE,
  DEFAULT_AGENTS
} from '../types';
import { globalEventBus } from '../../infrastructure/event-bus';
import { createLogger } from '@/shared/utils/logger';
import { i18nService } from '@/infrastructure/i18n';

const log = createLogger('AppManager');

export class AppManager implements IAppManager {
  private state: AppState;
  private listeners = new Set<(event: AppEvent) => void>();

  constructor() {
    // Initialize state
    this.state = {
      layout: { 
        ...DEFAULT_LAYOUT_STATE,
        leftPanelWidth: typeof window !== 'undefined' && window.innerWidth > 0 
          ? Math.min(300, Math.floor(window.innerWidth * 0.15)) // Left 15%, max 300px
          : 280,
      },
      currentAgent: DEFAULT_AGENTS[0],
      availableAgents: [...DEFAULT_AGENTS],
      chatSessions: [],
      activeChatSession: null,
      extensions: [],
      isLoading: false,
      error: null
    };

    // Set up event listeners
    this.setupEventListeners();
  }

  // State management
  getState(): AppState {
    return { ...this.state };
  }

  private updateState(updates: Partial<AppState>): void {
    this.state = { ...this.state, ...updates };
    this.notifyStateChange();
  }

  updateLayout(layout: Partial<LayoutState>): void {
    const newLayout = { ...this.state.layout, ...layout };
    this.state = { ...this.state, layout: newLayout };
    this.notifyStateChange();
    
    this.emitEvent({
      type: 'layout:changed',
      payload: layout
    });
  }

  async updateAgentConfig(agentId: string, config: Partial<AgentConfig>): Promise<void> {
    const agentIndex = this.state.availableAgents.findIndex(a => a.id === agentId);
    if (agentIndex === -1) {
      throw new Error(`Agent not found: ${agentId}`);
    }

    const updatedAgents = [...this.state.availableAgents];
    const currentAgent = updatedAgents[agentIndex];
    updatedAgents[agentIndex] = {
      ...currentAgent,
      config: { 
        ...currentAgent.config,
        ...config
      } as AgentConfig
    };

    this.updateState({ availableAgents: updatedAgents });

    // Also update currentAgent when it matches
    if (this.state.currentAgent?.id === agentId) {
      this.updateState({ currentAgent: updatedAgents[agentIndex] });
    }

    this.emitEvent({
      type: 'agent:changed',
      payload: updatedAgents[agentIndex]
    });
  }

  // Chat management
  async createChatSession(agentId: string): Promise<ChatSession> {
    const agent = this.state.availableAgents.find(a => a.id === agentId);
    if (!agent) {
      throw new Error(`Agent not found: ${agentId}`);
    }

    const session: ChatSession = {
      id: `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      title: i18nService.t('flow-chat:session.chatWithAgent', { name: agent.name }),
      messages: [],
      agentId,
      createdAt: new Date(),
      updatedAt: new Date(),
      isActive: true
    };

    // Add system message
    if (agent.config?.systemPrompt) {
      session.messages.push({
        id: `msg_${Date.now()}`,
        role: 'system',
        content: agent.config.systemPrompt,
        timestamp: new Date(),
        agentId
      });
    }

    const updatedSessions = [...this.state.chatSessions, session];
    this.updateState({ 
      chatSessions: updatedSessions,
      activeChatSession: session
    });

    this.emitEvent({
      type: 'chat:session:created',
      payload: session
    });

    return session;
  }

  selectChatSession(sessionId: string): void {
    const session = this.state.chatSessions.find(s => s.id === sessionId);
    if (!session) {
      throw new Error(`Chat session not found: ${sessionId}`);
    }

    this.updateState({ activeChatSession: session });

    this.emitEvent({
      type: 'chat:session:selected',
      payload: session
    });
  }

  async sendMessage(sessionId: string, content: string): Promise<void> {
    const session = this.state.chatSessions.find(s => s.id === sessionId);
    if (!session) {
      throw new Error(`Chat session not found: ${sessionId}`);
    }

    const userMessage: ChatMessage = {
      id: `msg_${Date.now()}_user`,
      role: 'user',
      content,
      timestamp: new Date(),
      agentId: session.agentId
    };

    // Add user message
    const updatedMessages = [...session.messages, userMessage];
    const updatedSession = { 
      ...session, 
      messages: updatedMessages,
      updatedAt: new Date()
    };

    const updatedSessions = this.state.chatSessions.map(s => 
      s.id === sessionId ? updatedSession : s
    );

    this.updateState({ 
      chatSessions: updatedSessions,
      activeChatSession: updatedSession
    });

    this.emitEvent({
      type: 'chat:message:sent',
      payload: { sessionId, message: userMessage }
    });

  }

  // Extension management
  async enableExtension(extensionId: string): Promise<void> {
    const extensionIndex = this.state.extensions.findIndex(e => e.id === extensionId);
    if (extensionIndex === -1) {
      throw new Error(`Extension not found: ${extensionId}`);
    }

    const updatedExtensions = [...this.state.extensions];
    updatedExtensions[extensionIndex] = {
      ...updatedExtensions[extensionIndex],
      isEnabled: true
    };

    this.updateState({ extensions: updatedExtensions });

    this.emitEvent({
      type: 'extension:enabled',
      payload: updatedExtensions[extensionIndex]
    });
  }

  async disableExtension(extensionId: string): Promise<void> {
    const extensionIndex = this.state.extensions.findIndex(e => e.id === extensionId);
    if (extensionIndex === -1) {
      throw new Error(`Extension not found: ${extensionId}`);
    }

    const updatedExtensions = [...this.state.extensions];
    updatedExtensions[extensionIndex] = {
      ...updatedExtensions[extensionIndex],
      isEnabled: false
    };

    this.updateState({ extensions: updatedExtensions });

    this.emitEvent({
      type: 'extension:disabled',
      payload: updatedExtensions[extensionIndex]
    });
  }

  async configureExtension(extensionId: string, config: Record<string, any>): Promise<void> {
    const extensionIndex = this.state.extensions.findIndex(e => e.id === extensionId);
    if (extensionIndex === -1) {
      throw new Error(`Extension not found: ${extensionId}`);
    }

    const updatedExtensions = [...this.state.extensions];
    updatedExtensions[extensionIndex] = {
      ...updatedExtensions[extensionIndex],
      config: { ...updatedExtensions[extensionIndex].config, ...config }
    };

    this.updateState({ extensions: updatedExtensions });
  }

  // Error handling
  clearError(): void {
    this.updateState({ error: null });
  }

  // Event listeners
  addEventListener(listener: (event: AppEvent) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  // Private methods
  private emitEvent(event: AppEvent): void {
    this.listeners.forEach(listener => {
      try {
        listener(event);
      } catch (error) {
        log.error('Error in event listener', error);
      }
    });

    // Emit to global event bus
    globalEventBus.emit(`app:${event.type}`, event.payload);
  }

  private notifyStateChange(): void {
    globalEventBus.emit('app:state:changed', this.state);
  }

  private setupEventListeners(): void {
    // Listen for global events
    globalEventBus.on('workspace:changed', () => {
      // Reset related state on workspace change
      this.updateState({
        chatSessions: [],
        activeChatSession: null
      });
    });

    // Listen for window resize with debounce
    if (typeof window !== 'undefined') {
      let resizeTimer: NodeJS.Timeout;
      
      const handleResize = () => {
        // Debounce: only run the last call within 200ms
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(() => {
          const windowWidth = window.innerWidth;
          // Left 15%, max 300px
          const newLeftPanelWidth = Math.min(300, Math.max(200, Math.floor(windowWidth * 0.15)));
          this.updateLayout({
            leftPanelWidth: newLeftPanelWidth,
          });
        }, 200);
      };

      window.addEventListener('resize', handleResize);
      
      // Cleanup
      globalEventBus.on('app:shutdown', () => {
        clearTimeout(resizeTimer);
        window.removeEventListener('resize', handleResize);
      });
    }
  }


  // Cleanup resources
  destroy(): void {
    this.listeners.clear();
  }
}

// Default application manager instance
export const appManager = new AppManager();
