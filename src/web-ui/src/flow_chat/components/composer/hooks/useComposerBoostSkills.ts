import { useCallback, useEffect, useRef, useState } from 'react';
import { createLogger } from '@/shared/utils/logger';
import { buildSkillLibraryUnits, type SkillLibraryUnit } from '@/shared/skillLibrary';

const log = createLogger('ComposerBoostSkills');

export function useComposerBoostSkills({
  dropdownOpen,
  workspacePath,
  agentId,
}: {
  dropdownOpen: boolean;
  workspacePath?: string;
  agentId: string;
}) {
  const [boostSkillUnits, setBoostSkillUnits] = useState<SkillLibraryUnit[]>([]);
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
      setSkillsFlyoutLeft(r.right + 284 > window.innerWidth - 8);
      setSkillsFlyoutUp(r.top + 440 > window.innerHeight - 8);
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
        const [catalog, agentSkills] = await Promise.all([
          configAPI.getSkillConfigs({ workspacePath: workspacePath || undefined }),
          configAPI.getAgentSkillConfigs({
            agentId,
            workspacePath: workspacePath || undefined,
          }),
        ]);
        if (!cancelled) {
          setBoostSkillUnits(buildSkillLibraryUnits(
            catalog,
            agentSkills.filter(skill => skill.selectedForRuntime),
          ).filter(unit => unit.kind === 'skill' || unit.members.length > 0));
        }
      } catch (err) {
        log.error('Failed to load skills for boost panel', { err });
        if (!cancelled) {
          setBoostSkillUnits([]);
        }
      } finally {
        if (!cancelled) setBoostSkillsLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [agentId, dropdownOpen, workspacePath]);

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
    boostSkillUnits,
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
