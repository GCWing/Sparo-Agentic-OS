import type React from 'react';

/**
 * Design-system preview type definitions.
 */
export type PreviewTier = 'primitive' | 'pattern' | 'recipe';

export interface AiUsageGuide {
  useWhen?: string[];
  composeWith?: string[];
  avoid?: string[];
  states?: string[];
  recipe?: string;
}

export interface PreviewExample {
  id: string;
  name: string;
  description: string;
  category: string;
  render: React.ComponentType;
  props?: Record<string, unknown>;
  ai?: AiUsageGuide;
}

export type LayoutType = 
  | 'full-page'    // Full-page preview
  | 'large-card'   // Single-column large card
  | 'demo'         // Live demo (feedback examples)
  | 'column'       // Columns with quick navigation
  | 'grid-2'       // Two-column grid (form examples)
  | 'grid-3'       // Three-column grid (standard showcase)
  | 'grid-4'       // Four-column grid (small examples)
  | 'default';     // Default layout

export interface PreviewCategory {
  id: string;
  name: string;
  description: string;
  examples: PreviewExample[];
  layoutType?: LayoutType;
  tier?: PreviewTier;
  aiRole?: string;
  decisionRules?: string[];
}
