import { useCallback, useEffect, useRef, useState } from 'react';
import type { SkillInfo } from '@/infrastructure/config/types';
import { createLogger } from '@/shared/utils/logger';

const log = createLogger('ComposerBoostSkills');

export function useComposerBoostSkills({
  dropdownOpen,
  workspacePath,
}: {
  dropdownOpen: boolean;
  workspacePath?: string;
}) {
  const [boostPanelSkills, setBoostPanelSkills] = useState<SkillInfo[]>([]);
  const [boostSkillsLoading, setBoostSkillsLoading] = useState(false);
  const [skillsFlyoutOpen, setSkillsFlyoutOpen] = useState(false);
  const [skillsFlyoutLeft, setSkillsFlyoutLeft] = useState(false);
  const [skillsFlyoutUp, setSkillsFlyoutUp] = useState(false);
  const [skillsTooltipSuppressed, setSkillsTooltipSuppressed] = useState(false);
  const skillsHostRef = useRef<HTMLDivElement>(null);
  const skillsTimerRef = useRef<number | null>(null);
  const skillsScrollTimerRef = useRef<number | null>(null);

  const clearSkillsTimer = useCallback(() => {
    if (skillsTimerRef.current !== null) {
      window.clearTimeout(skillsTimerRef.current);
      skillsTimerRef.current = null;
    }
  }, []);

  const openSkillsFlyout = useCallback(() => {
    clearSkillsTimer();
    const host = skillsHostRef.current;
    if (host) {
      const r = host.getBoundingClientRect();
      setSkillsFlyoutLeft(r.right + 260 > window.innerWidth - 8);
      setSkillsFlyoutUp(r.top + 200 > window.innerHeight - 8);
    }
    setSkillsFlyoutOpen(true);
  }, [clearSkillsTimer]);

  const closeSkillsFlyout = useCallback(() => {
    clearSkillsTimer();
    skillsTimerRef.current = window.setTimeout(() => {
      skillsTimerRef.current = null;
      setSkillsFlyoutOpen(false);
    }, 150);
  }, [clearSkillsTimer]);

  const dismissSkillsFlyout = useCallback(() => {
    clearSkillsTimer();
    setSkillsFlyoutOpen(false);
  }, [clearSkillsTimer]);

  const handleSkillsListScroll = useCallback(() => {
    setSkillsTooltipSuppressed(true);
    if (skillsScrollTimerRef.current !== null) {
      window.clearTimeout(skillsScrollTimerRef.current);
    }
    skillsScrollTimerRef.current = window.setTimeout(() => {
      skillsScrollTimerRef.current = null;
      setSkillsTooltipSuppressed(false);
    }, 180);
  }, []);

  useEffect(() => {
    if (!dropdownOpen) {
      return;
    }

    let cancelled = false;
    setBoostSkillsLoading(true);

    (async () => {
      try {
        const { configAPI } = await import('@/infrastructure/api');
        const list = await configAPI.getSkillConfigs({
          workspacePath: workspacePath || undefined,
        });
        if (!cancelled) {
          setBoostPanelSkills(list);
        }
      } catch (err) {
        log.error('Failed to load skills for boost panel', { err });
        if (!cancelled) setBoostPanelSkills([]);
      } finally {
        if (!cancelled) setBoostSkillsLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [dropdownOpen, workspacePath]);

  useEffect(() => {
    if (!dropdownOpen) {
      clearSkillsTimer();
      setSkillsFlyoutOpen(false);
    }
  }, [clearSkillsTimer, dropdownOpen]);

  useEffect(
    () => () => {
      clearSkillsTimer();
      if (skillsScrollTimerRef.current !== null) {
        window.clearTimeout(skillsScrollTimerRef.current);
        skillsScrollTimerRef.current = null;
      }
    },
    [clearSkillsTimer],
  );

  return {
    boostPanelSkills,
    boostSkillsLoading,
    closeSkillsFlyout,
    dismissSkillsFlyout,
    handleSkillsListScroll,
    openSkillsFlyout,
    setSkillsFlyoutOpen,
    skillsFlyoutLeft,
    skillsFlyoutOpen,
    skillsFlyoutUp,
    skillsHostRef,
    skillsTooltipSuppressed,
  };
}
