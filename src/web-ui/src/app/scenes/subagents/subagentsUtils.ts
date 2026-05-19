import type { SubagentInfo } from '@/infrastructure/api/service-api/SubagentAPI';

type SubagentTranslate = (key: string, options?: Record<string, unknown>) => string;

function isBuiltinSubagent(item: Pick<SubagentInfo, 'subagentSource'>): boolean {
  return (item.subagentSource ?? 'builtin') === 'builtin';
}

export function resolveSubagentName(
  item: Pick<SubagentInfo, 'id' | 'name' | 'subagentSource'>,
  t: SubagentTranslate,
): string {
  if (!isBuiltinSubagent(item)) {
    return item.name;
  }
  return t(`builtin.${item.id}.name`, { defaultValue: item.name });
}

export function resolveSubagentDescription(
  item: Pick<SubagentInfo, 'id' | 'description' | 'subagentSource'>,
  t: SubagentTranslate,
): string {
  if (!isBuiltinSubagent(item)) {
    return item.description;
  }
  return t(`builtin.${item.id}.description`, { defaultValue: item.description });
}
