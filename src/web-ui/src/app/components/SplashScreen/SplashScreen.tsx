/**
 * SplashScreen — full-screen overlay shown on app start.
 *
 * Shows the Sparo wordmark logo (theme-aware PNG) with a short fade-in.
 * No spinner or looping motion so startup feels like branding, not “still loading”.
 */

import React, { useEffect, useCallback } from 'react';
import './SplashScreen.scss';

interface SplashScreenProps {
  isExiting: boolean;
  onExited: () => void;
}

const SplashScreen: React.FC<SplashScreenProps> = ({ isExiting, onExited }) => {
  const handleExited = useCallback(() => {
    onExited();
  }, [onExited]);

  // Remove from DOM after exit animation completes (~650 ms).
  useEffect(() => {
    if (!isExiting) return;
    const timer = window.setTimeout(handleExited, 650);
    return () => window.clearTimeout(timer);
  }, [isExiting, handleExited]);

  return (
    <div
      className={`splash-screen${isExiting ? ' splash-screen--exiting' : ''}`}
      aria-hidden="true"
    >
      <div className="splash-screen__loader">
        <span className="splash-screen__logo-mark" aria-hidden="true">
          <img
            className="splash-screen__logo-img splash-screen__logo-img--dark"
            src="/logo-dark-transparent.png"
            alt=""
            draggable={false}
          />
          <img
            className="splash-screen__logo-img splash-screen__logo-img--light"
            src="/logo-light-transparent.png"
            alt=""
            draggable={false}
          />
        </span>
      </div>
    </div>
  );
};

export default SplashScreen;
