import { forwardRef, type ComponentType, type SVGProps } from 'react';
import { SparoSystemIcon, type SparoSystemIconProps } from './SparoSystemIcon';
import type { SystemIconName } from '../icon-manifest';

export type NamedSystemIconProps = Omit<SparoSystemIconProps, 'name'>;
export type NamedSystemIcon = ComponentType<NamedSystemIconProps & SVGProps<SVGSVGElement>>;

function createSystemIcon(name: SystemIconName, displayName: string) {
  const Icon = forwardRef<SVGSVGElement, NamedSystemIconProps>((props, ref) => (
    <SparoSystemIcon ref={ref} name={name} {...props} />
  ));
  Icon.displayName = displayName;
  return Icon;
}

export const SparoHubIcon = createSystemIcon('sparo-hub', 'SparoHubIcon');
export const WorkCenterIcon = createSystemIcon('work-center', 'WorkCenterIcon');
export const AppCenterIcon = createSystemIcon('app-center', 'AppCenterIcon');
export const DailyLetterIcon = createSystemIcon('daily-letter', 'DailyLetterIcon');
export const MemoryIcon = createSystemIcon('memory', 'MemoryIcon');
export const FilesIcon = createSystemIcon('files', 'FilesIcon');
export const TerminalIcon = createSystemIcon('terminal', 'TerminalIcon');
export const SkillsIcon = createSystemIcon('skills', 'SkillsIcon');
export const ToolsIcon = createSystemIcon('tools', 'ToolsIcon');
export const SubagentIcon = createSystemIcon('subagent', 'SubagentIcon');
export const SettingsIcon = createSystemIcon('settings', 'SettingsIcon');
export const FullOpenIcon = createSystemIcon('full-open', 'FullOpenIcon');
export const NormalWorkIcon = createSystemIcon('normal-work', 'NormalWorkIcon');
export const MultiStepWorkIcon = createSystemIcon('multi-step-work', 'MultiStepWorkIcon');
export const LongRunningWorkIcon = createSystemIcon('long-running-work', 'LongRunningWorkIcon');
export const TopicWorkIcon = createSystemIcon('topic-work', 'TopicWorkIcon');
export const RecurringWorkIcon = createSystemIcon('recurring-work', 'RecurringWorkIcon');
export const IntelligentAppWorkIcon = createSystemIcon('intelligent-app-work', 'IntelligentAppWorkIcon');
export const DelegatedWorkIcon = createSystemIcon('delegated-work', 'DelegatedWorkIcon');
export const SystemWorkIcon = createSystemIcon('system-work', 'SystemWorkIcon');
export const BackIcon = createSystemIcon('back', 'BackIcon');
export const ForwardIcon = createSystemIcon('forward', 'ForwardIcon');
export const ExternalOpenIcon = createSystemIcon('external-open', 'ExternalOpenIcon');
export const ExpandIcon = createSystemIcon('expand', 'ExpandIcon');
export const CollapseIcon = createSystemIcon('collapse', 'CollapseIcon');
export const CloseIcon = createSystemIcon('close', 'CloseIcon');
export const SearchIcon = createSystemIcon('search', 'SearchIcon');
export const ClearIcon = createSystemIcon('clear', 'ClearIcon');
export const FilterIcon = createSystemIcon('filter', 'FilterIcon');
export const SortIcon = createSystemIcon('sort', 'SortIcon');
export const OpenDirectoryIcon = createSystemIcon('open-directory', 'OpenDirectoryIcon');
export const UploadIcon = createSystemIcon('upload', 'UploadIcon');
export const DownloadIcon = createSystemIcon('download', 'DownloadIcon');
export const ExportIcon = createSystemIcon('export', 'ExportIcon');
export const CopyIcon = createSystemIcon('copy', 'CopyIcon');
export const AddIcon = createSystemIcon('add', 'AddIcon');
export const EditIcon = createSystemIcon('edit', 'EditIcon');
export const DeleteIcon = createSystemIcon('delete', 'DeleteIcon');
export const SaveApplyIcon = createSystemIcon('save-apply', 'SaveApplyIcon');
export const CancelIcon = createSystemIcon('cancel', 'CancelIcon');
export const ResetIcon = createSystemIcon('reset', 'ResetIcon');
export const UndoIcon = createSystemIcon('undo', 'UndoIcon');
export const RefreshIcon = createSystemIcon('refresh', 'RefreshIcon');
export const RetryIcon = createSystemIcon('retry', 'RetryIcon');
export const PanelRightClosedIcon = createSystemIcon('panel-right-closed', 'PanelRightClosedIcon');
export const PanelRightOpenIcon = createSystemIcon('panel-right-open', 'PanelRightOpenIcon');
export const PanelLeftClosedIcon = createSystemIcon('panel-left-closed', 'PanelLeftClosedIcon');
export const PanelLeftOpenIcon = createSystemIcon('panel-left-open', 'PanelLeftOpenIcon');
export const PanelBottomClosedIcon = createSystemIcon('panel-bottom-closed', 'PanelBottomClosedIcon');
export const PanelBottomOpenIcon = createSystemIcon('panel-bottom-open', 'PanelBottomOpenIcon');
export const PanelBottomHalfIcon = createSystemIcon('panel-bottom-half', 'PanelBottomHalfIcon');
export const PanelBottomMaximizedIcon = createSystemIcon('panel-bottom-maximized', 'PanelBottomMaximizedIcon');
export const PanelFloatingIcon = createSystemIcon('panel-floating', 'PanelFloatingIcon');
export const PanelDockedIcon = createSystemIcon('panel-docked', 'PanelDockedIcon');
export const PanelPinnedIcon = createSystemIcon('panel-pinned', 'PanelPinnedIcon');
export const LayoutResetIcon = createSystemIcon('layout-reset', 'LayoutResetIcon');
