const ICON_GRADIENTS = [
  { rgb: '59 130 246', gradient: 'linear-gradient(135deg, var(--ds-card-gradient-blue-start, rgba(59,130,246,0.28)) 0%, var(--ds-card-gradient-blue-end, rgba(139,92,246,0.18)) 100%)' },
  { rgb: '16 185 129', gradient: 'linear-gradient(135deg, var(--ds-card-gradient-green-start, rgba(16,185,129,0.24)) 0%, var(--ds-card-gradient-green-end, rgba(59,130,246,0.18)) 100%)' },
  { rgb: '245 158 11', gradient: 'linear-gradient(135deg, var(--ds-card-gradient-warning-start, rgba(245,158,11,0.22)) 0%, var(--ds-card-gradient-warning-end, rgba(239,68,68,0.16)) 100%)' },
  { rgb: '139 92 246', gradient: 'linear-gradient(135deg, var(--ds-card-gradient-purple-start, rgba(139,92,246,0.28)) 0%, var(--ds-card-gradient-purple-end, rgba(236,72,153,0.18)) 100%)' },
  { rgb: '6 182 212', gradient: 'linear-gradient(135deg, var(--ds-card-gradient-cyan-start, rgba(6,182,212,0.22)) 0%, var(--ds-card-gradient-green-end, rgba(59,130,246,0.18)) 100%)' },
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
