import {
  DelegatedWorkIcon,
  IntelligentAppWorkIcon,
  LongRunningWorkIcon,
  MultiStepWorkIcon,
  NormalWorkIcon,
  RecurringWorkIcon,
  SystemWorkIcon,
  TopicWorkIcon,
  type NamedSystemIcon,
} from '@/design-system';
import type { WorkKind } from '../domain/workTypes';

const WORK_KIND_ICONS: Record<WorkKind, NamedSystemIcon> = {
  one_shot: NormalWorkIcon,
  multi_step: MultiStepWorkIcon,
  long_running_session: LongRunningWorkIcon,
  recurring: RecurringWorkIcon,
  tracking: LongRunningWorkIcon,
  topic: TopicWorkIcon,
  app_workflow: IntelligentAppWorkIcon,
  delegated_work: DelegatedWorkIcon,
};

export function getWorkKindIcon(kind: WorkKind): NamedSystemIcon {
  return WORK_KIND_ICONS[kind];
}

export function getWorkTypeIcon(work: {
  kind: WorkKind;
  systemManaged?: boolean;
}): NamedSystemIcon {
  return work.systemManaged ? SystemWorkIcon : getWorkKindIcon(work.kind);
}
