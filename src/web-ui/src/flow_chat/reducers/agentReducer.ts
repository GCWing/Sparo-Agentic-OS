/**
 * Agent state reducer
 */

export interface AgentInfo {
  id: string;
  name: string;
  description: string;
  isReadonly: boolean;
  toolCount: number;
  defaultTools?: string[];
  enabled: boolean;
}

export interface AgentState {
  /** Current agent id */
  current: string;
  /** Available agents */
  available: AgentInfo[];
  /** Dropdown open state */
  dropdownOpen: boolean;
}

export type AgentAction =
  | { type: 'SET_CURRENT_AGENT'; payload: string }
  | { type: 'SET_AVAILABLE_AGENTS'; payload: AgentInfo[] }
  | { type: 'OPEN_DROPDOWN' }
  | { type: 'CLOSE_DROPDOWN' }
  | { type: 'TOGGLE_DROPDOWN' };

export const initialAgentState: AgentState = {
  current: 'Runno',
  available: [],
  dropdownOpen: false,
};

export function agentReducer(state: AgentState, action: AgentAction): AgentState {
  switch (action.type) {
    case 'SET_CURRENT_AGENT':
      return { ...state, current: action.payload };
      
    case 'SET_AVAILABLE_AGENTS':
      return { ...state, available: action.payload };
      
    case 'OPEN_DROPDOWN':
      return { ...state, dropdownOpen: true };
      
    case 'CLOSE_DROPDOWN':
      return { ...state, dropdownOpen: false };
      
    case 'TOGGLE_DROPDOWN':
      return { ...state, dropdownOpen: !state.dropdownOpen };
      
    default:
      return state;
  }
}

