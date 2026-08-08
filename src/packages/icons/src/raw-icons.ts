import sparoHubSvg from './svg/base/sparo-hub.svg?raw';
import workCenterSvg from './svg/base/work-center.svg?raw';
import appCenterSvg from './svg/base/app-center.svg?raw';
import dailyLetterSvg from './svg/base/daily-letter.svg?raw';
import memorySvg from './svg/base/memory.svg?raw';
import filesSvg from './svg/base/files.svg?raw';
import terminalSvg from './svg/base/terminal.svg?raw';
import skillsSvg from './svg/base/skills.svg?raw';
import toolsSvg from './svg/base/tools.svg?raw';
import subagentSvg from './svg/base/subagent.svg?raw';
import settingsSvg from './svg/base/settings.svg?raw';
import fullOpenSvg from './svg/base/full-open.svg?raw';
import normalWorkSvg from './svg/base/normal-work.svg?raw';
import multiStepWorkSvg from './svg/base/multi-step-work.svg?raw';
import longRunningWorkSvg from './svg/base/long-running-work.svg?raw';
import topicWorkSvg from './svg/base/topic-work.svg?raw';
import recurringWorkSvg from './svg/base/recurring-work.svg?raw';
import intelligentAppWorkSvg from './svg/base/intelligent-app-work.svg?raw';
import delegatedWorkSvg from './svg/base/delegated-work.svg?raw';
import systemWorkSvg from './svg/base/system-work.svg?raw';
import backSvg from './svg/base/back.svg?raw';
import forwardSvg from './svg/base/forward.svg?raw';
import externalOpenSvg from './svg/base/external-open.svg?raw';
import expandSvg from './svg/base/expand.svg?raw';
import collapseSvg from './svg/base/collapse.svg?raw';
import closeSvg from './svg/base/close.svg?raw';
import searchSvg from './svg/base/search.svg?raw';
import clearSvg from './svg/base/clear.svg?raw';
import filterSvg from './svg/base/filter.svg?raw';
import sortSvg from './svg/base/sort.svg?raw';
import openDirectorySvg from './svg/base/open-directory.svg?raw';
import uploadSvg from './svg/base/upload.svg?raw';
import downloadSvg from './svg/base/download.svg?raw';
import exportSvg from './svg/base/export.svg?raw';
import copySvg from './svg/base/copy.svg?raw';
import addSvg from './svg/base/add.svg?raw';
import editSvg from './svg/base/edit.svg?raw';
import deleteSvg from './svg/base/delete.svg?raw';
import saveApplySvg from './svg/base/save-apply.svg?raw';
import cancelSvg from './svg/base/cancel.svg?raw';
import resetSvg from './svg/base/reset.svg?raw';
import undoSvg from './svg/base/undo.svg?raw';
import refreshSvg from './svg/base/refresh.svg?raw';
import retrySvg from './svg/base/retry.svg?raw';
import panelRightClosedSvg from './svg/base/panel-right-closed.svg?raw';
import panelRightOpenSvg from './svg/base/panel-right-open.svg?raw';
import panelLeftClosedSvg from './svg/base/panel-left-closed.svg?raw';
import panelLeftOpenSvg from './svg/base/panel-left-open.svg?raw';
import panelBottomClosedSvg from './svg/base/panel-bottom-closed.svg?raw';
import panelBottomOpenSvg from './svg/base/panel-bottom-open.svg?raw';
import panelBottomHalfSvg from './svg/base/panel-bottom-half.svg?raw';
import panelBottomMaximizedSvg from './svg/base/panel-bottom-maximized.svg?raw';
import panelFloatingSvg from './svg/base/panel-floating.svg?raw';
import panelDockedSvg from './svg/base/panel-docked.svg?raw';
import panelPinnedSvg from './svg/base/panel-pinned.svg?raw';
import layoutResetSvg from './svg/base/layout-reset.svg?raw';
import type { SystemIconName } from './icon-manifest';

export const rawSystemIcons: Record<SystemIconName, string> = {
  'sparo-hub': sparoHubSvg,
  'work-center': workCenterSvg,
  'app-center': appCenterSvg,
  'daily-letter': dailyLetterSvg,
  memory: memorySvg,
  files: filesSvg,
  terminal: terminalSvg,
  skills: skillsSvg,
  tools: toolsSvg,
  subagent: subagentSvg,
  settings: settingsSvg,
  'full-open': fullOpenSvg,
  'normal-work': normalWorkSvg,
  'multi-step-work': multiStepWorkSvg,
  'long-running-work': longRunningWorkSvg,
  'topic-work': topicWorkSvg,
  'recurring-work': recurringWorkSvg,
  'intelligent-app-work': intelligentAppWorkSvg,
  'delegated-work': delegatedWorkSvg,
  'system-work': systemWorkSvg,
  back: backSvg,
  forward: forwardSvg,
  'external-open': externalOpenSvg,
  expand: expandSvg,
  collapse: collapseSvg,
  close: closeSvg,
  search: searchSvg,
  clear: clearSvg,
  filter: filterSvg,
  sort: sortSvg,
  'open-directory': openDirectorySvg,
  upload: uploadSvg,
  download: downloadSvg,
  export: exportSvg,
  copy: copySvg,
  add: addSvg,
  edit: editSvg,
  delete: deleteSvg,
  'save-apply': saveApplySvg,
  cancel: cancelSvg,
  reset: resetSvg,
  undo: undoSvg,
  refresh: refreshSvg,
  retry: retrySvg,
  'panel-right-closed': panelRightClosedSvg,
  'panel-right-open': panelRightOpenSvg,
  'panel-left-closed': panelLeftClosedSvg,
  'panel-left-open': panelLeftOpenSvg,
  'panel-bottom-closed': panelBottomClosedSvg,
  'panel-bottom-open': panelBottomOpenSvg,
  'panel-bottom-half': panelBottomHalfSvg,
  'panel-bottom-maximized': panelBottomMaximizedSvg,
  'panel-floating': panelFloatingSvg,
  'panel-docked': panelDockedSvg,
  'panel-pinned': panelPinnedSvg,
  'layout-reset': layoutResetSvg,
};

export function extractSvgBody(source: string): string {
  const match = source.match(/<svg\s+[^>]*>([\s\S]*)<\/svg>/);
  if (!match) {
    throw new Error('Invalid canonical Sparo icon SVG.');
  }
  return match[1].trim();
}

export const systemIconGlyphMarkup = Object.fromEntries(
  Object.entries(rawSystemIcons).map(([name, source]) => [name, extractSvgBody(source)]),
) as Record<SystemIconName, string>;
