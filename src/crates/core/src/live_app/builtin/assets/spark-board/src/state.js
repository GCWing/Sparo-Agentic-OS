export const DEFAULT_CARDS = [
  {
    id: 'seed-1',
    kind: 'idea',
    title: 'Canvas-first collaboration',
    body: 'AI responses become movable cards, not a buried chat transcript.',
    x: 64,
    y: 96
  },
  {
    id: 'seed-2',
    kind: 'question',
    title: 'What should AI do here?',
    body: 'Expand, cluster, challenge, and turn selected thoughts into send-ready text.',
    x: 360,
    y: 168
  },
  {
    id: 'seed-3',
    kind: 'insight',
    title: 'Keep the user in control',
    body: 'Every generated note should be editable, movable, selectable, and disposable.',
    x: 672,
    y: 108
  },
  {
    id: 'seed-4',
    kind: 'output',
    title: 'Send-ready promise',
    body: 'The board is done when a messy thought becomes a message someone can act on.',
    x: 812,
    y: 328
  }
];

export const SCHEMA_VERSION = 2;

export function clone(value) {
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}
