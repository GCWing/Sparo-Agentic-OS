/** Installation step identifiers */
export type InstallStep = 'lang' | 'options' | 'progress' | 'uninstall';

export interface LaunchContext {
  mode: 'install' | 'uninstall';
  uninstallPath: string | null;
}

export interface InstallPathValidation {
  installPath: string;
}

/** Installation options sent to the Rust backend */
export interface InstallOptions {
  installPath: string;
  desktopShortcut: boolean;
  startMenu: boolean;
  contextMenu: boolean;
  addToPath: boolean;
}

/** Progress update received from the backend */
export interface InstallProgress {
  step: string;
  percent: number;
  message: string;
}

/** Disk space information */
export interface DiskSpaceInfo {
  total: number;
  available: number;
  required: number;
  sufficient: boolean;
}

/** Default installation options */
export const DEFAULT_OPTIONS: InstallOptions = {
  installPath: '',
  desktopShortcut: true,
  startMenu: true,
  contextMenu: true,
  addToPath: true,
};
