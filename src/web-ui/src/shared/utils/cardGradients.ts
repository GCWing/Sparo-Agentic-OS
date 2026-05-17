const ICON_GRADIENTS = [
  { rgb: 'var(--ds-color-accent-rgb)', gradient: 'linear-gradient(135deg, color-mix(in srgb, var(--ds-color-accent-600) 28%, transparent) 0%, color-mix(in srgb, var(--ds-color-purple-500) 18%, transparent) 100%)' },
  { rgb: 'var(--ds-color-success)', gradient: 'linear-gradient(135deg, color-mix(in srgb, var(--ds-color-success) 24%, transparent) 0%, color-mix(in srgb, var(--ds-color-accent-500) 18%, transparent) 100%)' },
  { rgb: 'var(--ds-color-warning)', gradient: 'linear-gradient(135deg, color-mix(in srgb, var(--ds-color-warning) 22%, transparent) 0%, color-mix(in srgb, var(--ds-color-danger) 16%, transparent) 100%)' },
  { rgb: 'var(--ds-color-purple-500)', gradient: 'linear-gradient(135deg, color-mix(in srgb, var(--ds-color-purple-500) 28%, transparent) 0%, color-mix(in srgb, var(--ds-color-accent-500) 18%, transparent) 100%)' },
  { rgb: 'var(--ds-color-info)', gradient: 'linear-gradient(135deg, color-mix(in srgb, var(--ds-color-info) 22%, transparent) 0%, color-mix(in srgb, var(--ds-color-success) 18%, transparent) 100%)' },
];

function getCardGradient(seed: string): string {
  const first = seed.trim().charCodeAt(0) || 0;
  return ICON_GRADIENTS[first % ICON_GRADIENTS.length].gradient;
}

function getCardColorRgb(seed: string): string {
  const first = seed.trim().charCodeAt(0) || 0;
  return ICON_GRADIENTS[first % ICON_GRADIENTS.length].rgb;
}

export { ICON_GRADIENTS, getCardGradient, getCardColorRgb };
