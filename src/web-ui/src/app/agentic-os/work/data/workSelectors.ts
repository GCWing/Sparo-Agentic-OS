import { compareWorksForDisplay } from '../projections/workOrdering';
import { projectWork, type WorkProjection } from '../projections/workProjection';
import { workMatchesQuery } from '../projections/workSearch';
import type { WorkRecord } from '../domain/workTypes';

export function selectWorkProjections(records: WorkRecord[]): WorkProjection[] {
  return records.map(projectWork).sort(compareWorksForDisplay);
}

export function filterWorkProjections(
  projections: WorkProjection[],
  query: string
): WorkProjection[] {
  return projections.filter((work) => workMatchesQuery(work, query));
}
