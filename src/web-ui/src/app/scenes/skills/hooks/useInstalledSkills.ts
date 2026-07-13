import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { open } from '@tauri-apps/plugin-dialog';
import { useTranslation } from 'react-i18next';
import { configAPI } from '@/infrastructure/api';
import type {
  AgentSkillInfo,
  SkillInfo,
  SkillLevel,
  SkillPackageValidationResult,
  SkillSuiteInfo,
} from '@/infrastructure/config/types';
import { useWorkspaceManagerSync } from '@/infrastructure/hooks/useWorkspaceManagerSync';
import {
  buildSkillLibraryUnits,
  filterSkillLibraryUnits,
  type SkillLibrarySourceFilter,
  type SkillLibraryTypeFilter,
  type SkillLibraryUnit,
} from '@/shared/skillLibrary';
import { useNotification } from '@/shared/notification-system';
import { createLogger } from '@/shared/utils/logger';

const log = createLogger('SkillsScene:useInstalledSkills');

interface UseInstalledSkillsOptions {
  searchQuery: string;
  typeFilter: SkillLibraryTypeFilter;
  sourceFilter: SkillLibrarySourceFilter;
}

export function useInstalledSkills({
  searchQuery,
  typeFilter,
  sourceFilter,
}: UseInstalledSkillsOptions) {
  const { t } = useTranslation('scenes/skills');
  const notification = useNotification();
  const { workspacePath, hasWorkspace } = useWorkspaceManagerSync();

  const [skills, setSkills] = useState<SkillInfo[]>([]);
  const [suites, setSuites] = useState<SkillSuiteInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [formLevel, setFormLevel] = useState<SkillLevel>('user');
  const [formPath, setFormPath] = useState('');
  const [validationResult, setValidationResult] = useState<SkillPackageValidationResult | null>(null);
  const [isValidating, setIsValidating] = useState(false);
  const [isAdding, setIsAdding] = useState(false);
  const [agentIds, setAgentIds] = useState<string[]>([]);
  const [selectedAgentId, setSelectedAgentId] = useState('');
  const [agentSkills, setAgentSkills] = useState<AgentSkillInfo[]>([]);
  const [isAgentSkillsLoading, setIsAgentSkillsLoading] = useState(false);
  const [updatingAvailabilityKey, setUpdatingAvailabilityKey] = useState<string | null>(null);
  const loadRequestIdRef = useRef(0);
  const agentSkillsRequestIdRef = useRef(0);

  const loadSkills = useCallback(async (forceRefresh?: boolean) => {
    const requestId = ++loadRequestIdRef.current;
    try {
      setLoading(true);
      setError(null);
      const catalog = await configAPI.getSkillConfigs({
        forceRefresh,
        workspacePath: workspacePath || undefined,
      });
      if (requestId !== loadRequestIdRef.current) return;
      setSkills(catalog.skills);
      setSuites(catalog.suites);
    } catch (error) {
      if (requestId !== loadRequestIdRef.current) return;
      log.error('Failed to load Skill library', { error });
      setError(error instanceof Error ? error.message : String(error));
      setSkills([]);
      setSuites([]);
    } finally {
      if (requestId === loadRequestIdRef.current) setLoading(false);
    }
  }, [workspacePath]);

  useEffect(() => {
    void loadSkills();
  }, [loadSkills]);

  useEffect(() => {
    let cancelled = false;
    void configAPI.getAgentCapabilityConfigs()
      .then((configs) => {
        if (cancelled) return;
        const ids = Object.keys(configs).sort((left, right) => left.localeCompare(right));
        setAgentIds(ids);
        setSelectedAgentId(current => (
          current && ids.includes(current)
            ? current
            : ids.find(id => id === 'OSAgent') ?? ids[0] ?? ''
        ));
      })
      .catch((error) => {
        if (cancelled) return;
        log.error('Failed to load configurable agents for Skill management', { error });
        setAgentIds([]);
        setSelectedAgentId('');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const loadAgentSkills = useCallback(async (agentId: string, forceRefresh?: boolean) => {
    const requestId = ++agentSkillsRequestIdRef.current;
    if (!agentId) {
      setAgentSkills([]);
      setIsAgentSkillsLoading(false);
      return;
    }
    try {
      setIsAgentSkillsLoading(true);
      const nextAgentSkills = await configAPI.getAgentSkillConfigs({
        agentId,
        forceRefresh,
        workspacePath: workspacePath || undefined,
      });
      if (requestId !== agentSkillsRequestIdRef.current) return;
      setAgentSkills(nextAgentSkills);
    } catch (error) {
      if (requestId !== agentSkillsRequestIdRef.current) return;
      log.error('Failed to load Agent Skill availability', { agentId, error });
      setAgentSkills([]);
    } finally {
      if (requestId === agentSkillsRequestIdRef.current) setIsAgentSkillsLoading(false);
    }
  }, [workspacePath]);

  useEffect(() => {
    void loadAgentSkills(selectedAgentId);
  }, [loadAgentSkills, selectedAgentId]);

  const validatePath = useCallback(async (path: string) => {
    if (!path.trim()) {
      setValidationResult(null);
      return;
    }
    try {
      setIsValidating(true);
      setValidationResult(await configAPI.validateSkillPackagePath(path));
    } catch (error) {
      setValidationResult({
        valid: false,
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setIsValidating(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void validatePath(formPath), 300);
    return () => window.clearTimeout(timer);
  }, [formPath, validatePath]);

  const handleBrowse = useCallback(async () => {
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: t('form.path.label'),
      });
      if (selected) setFormPath(selected as string);
    } catch (error) {
      log.error('Failed to open Skill package picker', { error });
    }
  }, [t]);

  const resetForm = useCallback(() => {
    setFormPath('');
    setFormLevel('user');
    setValidationResult(null);
  }, []);

  const handleAdd = useCallback(async () => {
    if (!validationResult?.valid || !formPath.trim()) {
      notification.warning(t('messages.invalidPath'));
      return false;
    }
    if (formLevel === 'project' && !hasWorkspace) {
      notification.warning(t('messages.noWorkspace'));
      return false;
    }
    try {
      setIsAdding(true);
      await configAPI.addSkillPackage({
        sourcePath: formPath,
        level: formLevel,
        workspacePath: workspacePath || undefined,
      });
      notification.success(t('messages.addSuccess', { name: validationResult.name }));
      resetForm();
      await loadSkills(true);
      await loadAgentSkills(selectedAgentId, true);
      return true;
    } catch (error) {
      notification.error(t('messages.addFailed', {
        error: error instanceof Error ? error.message : String(error),
      }));
      return false;
    } finally {
      setIsAdding(false);
    }
  }, [
    formLevel,
    formPath,
    hasWorkspace,
    loadAgentSkills,
    loadSkills,
    notification,
    resetForm,
    selectedAgentId,
    t,
    validationResult,
    workspacePath,
  ]);

  const handleDelete = useCallback(async (unit: SkillLibraryUnit) => {
    try {
      await configAPI.deleteSkillPackage({
        kind: unit.kind === 'suite' ? 'suite' : 'skill',
        key: unit.key,
        workspacePath: workspacePath || undefined,
      });
      notification.success(t('messages.deleteSuccess', { name: unit.name }));
      await loadSkills(true);
      await loadAgentSkills(selectedAgentId, true);
      return true;
    } catch (error) {
      notification.error(t('messages.deleteFailed', {
        error: error instanceof Error ? error.message : String(error),
      }));
      return false;
    }
  }, [loadAgentSkills, loadSkills, notification, selectedAgentId, t, workspacePath]);

  const agentSkillsByKey = useMemo(
    () => new Map(agentSkills.map(skill => [skill.key, skill])),
    [agentSkills],
  );

  const isUnitDisabledForAgent = useCallback((unit: SkillLibraryUnit): boolean => {
    if (unit.kind === 'skill') {
      return agentSkillsByKey.get(unit.skill.key)?.disabledByAgent ?? false;
    }
    const memberStates = unit.suite.memberSkillKeys
      .map(key => agentSkillsByKey.get(key))
      .filter((skill): skill is AgentSkillInfo => Boolean(skill));
    return memberStates.length > 0 && memberStates.every(skill => skill.disabledByAgent);
  }, [agentSkillsByKey]);

  const setUnitDisabledForAgent = useCallback(async (
    unit: SkillLibraryUnit,
    disabled: boolean,
  ) => {
    if (!selectedAgentId) return false;
    try {
      setUpdatingAvailabilityKey(unit.key);
      if (unit.kind === 'suite') {
        await configAPI.setAgentSkillSuiteDisabled({
          agentId: selectedAgentId,
          suiteKey: unit.suite.id,
          disabled,
          workspacePath: workspacePath || undefined,
        });
      } else {
        await configAPI.setAgentSkillDisabled({
          agentId: selectedAgentId,
          skillKey: unit.skill.key,
          disabled,
          workspacePath: workspacePath || undefined,
        });
      }
      notification.success(t(disabled ? 'messages.disableSuccess' : 'messages.enableSuccess', {
        name: unit.name,
      }));
      await loadAgentSkills(selectedAgentId, true);
      return true;
    } catch (error) {
      notification.error(t('messages.availabilityUpdateFailed', {
        error: error instanceof Error ? error.message : String(error),
      }));
      return false;
    } finally {
      setUpdatingAvailabilityKey(null);
    }
  }, [loadAgentSkills, notification, selectedAgentId, t, workspacePath]);

  const units = useMemo(() => buildSkillLibraryUnits({ skills, suites }), [skills, suites]);
  const filteredUnits = useMemo(() => filterSkillLibraryUnits(units, {
    query: searchQuery,
    type: typeFilter,
    source: sourceFilter,
  }), [searchQuery, sourceFilter, typeFilter, units]);

  const counts = useMemo(() => ({
    type: {
      all: units.length,
      suite: units.filter(unit => unit.kind === 'suite').length,
      standalone: units.filter(unit => unit.kind === 'skill').length,
    },
    source: {
      all: units.length,
      builtin: filterSkillLibraryUnits(units, { source: 'builtin' }).length,
      user: filterSkillLibraryUnits(units, { source: 'user' }).length,
      project: filterSkillLibraryUnits(units, { source: 'project' }).length,
    },
  }), [units]);

  return {
    skills,
    suites,
    units,
    filteredUnits,
    counts,
    loading,
    error,
    loadSkills,
    handleDelete,
    agentIds,
    selectedAgentId,
    setSelectedAgentId,
    isAgentSkillsLoading,
    updatingAvailabilityKey,
    isUnitDisabledForAgent,
    setUnitDisabledForAgent,
    formLevel,
    setFormLevel,
    formPath,
    setFormPath,
    validationResult,
    isValidating,
    isAdding,
    handleBrowse,
    handleAdd,
    resetForm,
    workspacePath,
    hasWorkspace,
  };
}
