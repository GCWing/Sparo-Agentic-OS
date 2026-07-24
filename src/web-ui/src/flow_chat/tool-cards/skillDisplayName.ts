function nonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

export function resolveSkillDisplayName(
  resultValue: unknown,
  inputValue: unknown,
  unknownLabel: string,
): string {
  const result = resultValue && typeof resultValue === 'object'
    ? resultValue as Record<string, unknown>
    : {};
  const nested = result.data && typeof result.data === 'object'
    ? result.data as Record<string, unknown>
    : {};
  const input = inputValue && typeof inputValue === 'object'
    ? inputValue as Record<string, unknown>
    : {};
  const command = nonEmptyString(input.command) || nonEmptyString(input.skill_name);
  return nonEmptyString(result.suite_name)
    || nonEmptyString(nested.suite_name)
    || nonEmptyString(result.skill_name)
    || nonEmptyString(nested.skill_name)
    || nonEmptyString(result.name)
    || nonEmptyString(nested.name)
    || command?.replace(/^suite:/, '')
    || unknownLabel;
}
