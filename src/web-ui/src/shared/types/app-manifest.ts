export type ComponentKind = 'surface' | 'agent' | 'bridge' | 'runtime' | 'tool' | 'skill';

export type AppIconSpec =
  | {
    kind: 'packageAsset';
    path: string;
    mimeType?: string | null;
    digest?: string | null;
    uri?: string | null;
    background?: string | null;
  }
  | {
    kind: 'nativeAsset';
    assetId: string;
    mimeType?: string | null;
    digest?: string | null;
    uri?: string | null;
    background?: string | null;
  }
  | {
    kind: 'lucide';
    name: string;
    background?: string | null;
  }
  | {
    kind: 'monogram';
    label: string;
    seed?: string | null;
    background?: string | null;
  };

export type ProductAppRehearsalScenarioKind =
  | 'user-path'
  | 'agent-chat'
  | 'capability'
  | 'release-gate';
export type ProductAppRehearsalAction =
  | 'open'
  | 'focus'
  | 'click'
  | 'type'
  | 'submit'
  | 'observe';

export interface ProductAppRehearsalStep {
  id: string;
  action: ProductAppRehearsalAction;
  target?: string | null;
  value?: string | null;
  expect?: string[];
}

export interface ProductAppRehearsalScenario {
  id: string;
  title: string;
  description?: string;
  kind?: ProductAppRehearsalScenarioKind;
  steps?: ProductAppRehearsalStep[];
  expected?: string[];
}

export interface ProductAppRehearsalPlan {
  version?: number;
  scenarios?: ProductAppRehearsalScenario[];
}
