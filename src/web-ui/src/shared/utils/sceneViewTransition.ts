import { createLogger } from './logger';

const log = createLogger('SceneViewTransition');

export type SceneViewTransitionKind = 'open' | 'return' | 'switch';

type ViewTransitionDocument = Document & {
  startViewTransition?: (callback: () => void) => { finished: Promise<void> };
};

function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

function setSceneTransitionOrigin(): void {
  if (typeof document === 'undefined') return;

  const logo = document.querySelector<HTMLElement>('.unified-top-bar__logo-btn');
  const rect = logo?.getBoundingClientRect();
  const x = rect ? rect.left + rect.width / 2 : 24;
  const y = rect ? rect.top + rect.height / 2 : 24;

  document.documentElement.style.setProperty('--scene-transition-origin-x', `${x}px`);
  document.documentElement.style.setProperty('--scene-transition-origin-y', `${y}px`);
}

export function runSceneViewTransition(
  kind: SceneViewTransitionKind,
  update: () => void
): void {
  if (typeof document === 'undefined' || prefersReducedMotion()) {
    update();
    return;
  }

  const viewTransitionDocument = document as ViewTransitionDocument;
  if (!viewTransitionDocument.startViewTransition) {
    update();
    return;
  }

  const className = `scene-view-transition--${kind}`;
  setSceneTransitionOrigin();
  document.documentElement.classList.add(className);

  try {
    const transition = viewTransitionDocument.startViewTransition(() => update());
    transition.finished.finally(() => {
      document.documentElement.classList.remove(className);
    });
  } catch (error) {
    document.documentElement.classList.remove(className);
    log.warn('Scene view transition failed; updating without animation', { kind, error });
    update();
  }
}
