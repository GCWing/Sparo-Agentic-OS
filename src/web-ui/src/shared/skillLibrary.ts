import type {
  SkillCatalog,
  SkillInfo,
  SkillLevel,
  SkillSuiteInfo,
} from '@/infrastructure/config/types';

export type SkillLibraryTypeFilter = 'all' | 'suite' | 'standalone';
export type SkillLibrarySourceFilter = 'all' | 'builtin' | 'user' | 'project';

export interface SkillSuiteLibraryUnit {
  kind: 'suite';
  key: string;
  name: string;
  description: string;
  suite: SkillSuiteInfo;
  members: SkillInfo[];
}

export interface StandaloneSkillLibraryUnit {
  kind: 'skill';
  key: string;
  name: string;
  description: string;
  skill: SkillInfo;
}

export type SkillLibraryUnit = SkillSuiteLibraryUnit | StandaloneSkillLibraryUnit;

export interface SkillSelectionTarget {
  kind: 'suite' | 'skill';
  key: string;
  command: string;
  name: string;
  description: string;
  suiteId?: string;
  suiteName?: string;
  memberCount?: number;
}

function compareNames(left: { name: string }, right: { name: string }): number {
  return left.name.localeCompare(right.name, undefined, { sensitivity: 'base' });
}

export function buildSkillLibraryUnits(
  catalog: SkillCatalog,
  visibleSkills: SkillInfo[] = catalog.skills,
): SkillLibraryUnit[] {
  const visibleByKey = new Map(visibleSkills.map(skill => [skill.key, skill]));
  const suiteUnits = catalog.suites
    .map<SkillSuiteLibraryUnit>(suite => ({
      kind: 'suite',
      key: suite.key,
      name: suite.name,
      description: suite.description,
      suite,
      members: suite.memberSkillKeys
        .map(key => visibleByKey.get(key))
        .filter((skill): skill is SkillInfo => Boolean(skill)),
    }))
    .sort(compareNames);

  const standaloneUnits = visibleSkills
    .filter(skill => !skill.suiteKey)
    .map<StandaloneSkillLibraryUnit>(skill => ({
      kind: 'skill',
      key: skill.key,
      name: skill.name,
      description: skill.description,
      skill,
    }))
    .sort(compareNames);

  return [...suiteUnits, ...standaloneUnits];
}

function unitMatchesSource(unit: SkillLibraryUnit, source: SkillLibrarySourceFilter): boolean {
  if (source === 'all') return true;
  const item = unit.kind === 'suite' ? unit.suite : unit.skill;
  if (source === 'builtin') return item.isBuiltin;
  if (item.isBuiltin) return false;
  return item.level === source;
}

function unitSearchText(unit: SkillLibraryUnit): string[] {
  if (unit.kind === 'skill') {
    return [unit.skill.name, unit.skill.description, unit.skill.path, ...unit.skill.tags];
  }
  return [
    unit.suite.name,
    unit.suite.description,
    unit.suite.path,
    ...unit.suite.tags,
    ...unit.members.flatMap(member => [member.name, member.description, ...member.tags]),
  ];
}

export function filterSkillLibraryUnits(
  units: SkillLibraryUnit[],
  options: {
    query?: string;
    type?: SkillLibraryTypeFilter;
    source?: SkillLibrarySourceFilter;
  },
): SkillLibraryUnit[] {
  const query = options.query?.trim().toLocaleLowerCase() ?? '';
  const type = options.type ?? 'all';
  const source = options.source ?? 'all';

  return units.filter(unit => {
    if (type !== 'all' && unit.kind !== (type === 'standalone' ? 'skill' : 'suite')) return false;
    if (!unitMatchesSource(unit, source)) return false;
    return !query || unitSearchText(unit).some(value => value.toLocaleLowerCase().includes(query));
  });
}

export function skillLibraryUnitLevel(unit: SkillLibraryUnit): SkillLevel {
  return unit.kind === 'suite' ? unit.suite.level : unit.skill.level;
}

export function skillLibraryUnitIsBuiltin(unit: SkillLibraryUnit): boolean {
  return unit.kind === 'suite' ? unit.suite.isBuiltin : unit.skill.isBuiltin;
}

export function skillLibraryUnitCanDelete(unit: SkillLibraryUnit): boolean {
  return unit.kind === 'suite' ? unit.suite.canDelete : unit.skill.canDelete;
}

export function skillLibraryUnitPath(unit: SkillLibraryUnit): string {
  return unit.kind === 'suite' ? unit.suite.path : unit.skill.path;
}

export function selectionTargetFromUnit(unit: SkillLibraryUnit): SkillSelectionTarget {
  if (unit.kind === 'suite') {
    return {
      kind: 'suite',
      key: unit.suite.key,
      command: `suite:${unit.suite.id}`,
      name: unit.suite.name,
      description: unit.suite.description,
      suiteId: unit.suite.id,
      suiteName: unit.suite.name,
      memberCount: unit.members.length,
    };
  }
  return selectionTargetFromSkill(unit.skill);
}

export function selectionTargetFromSkill(
  skill: SkillInfo,
  suite?: SkillSuiteInfo,
): SkillSelectionTarget {
  return {
    kind: 'skill',
    key: skill.key,
    command: skill.name,
    name: skill.name,
    description: skill.description,
    suiteId: suite?.id ?? skill.suiteKey ?? undefined,
    suiteName: suite?.name,
  };
}
