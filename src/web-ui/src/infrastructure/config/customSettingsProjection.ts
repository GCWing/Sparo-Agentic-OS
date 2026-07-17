/**
 * Runtime contract between the Settings projection host and a rich custom
 * settings form. Catalog setting IDs are the only draft identities; tabs and
 * namespaces are never valid dirty-state shortcuts.
 */
export interface CustomSettingsProjectionProps {
  /** True when the configuration service is serving non-persistent recovery defaults. */
  disabled: boolean;
  /** Latest authoritative user-config revision, or null before the first snapshot. */
  snapshotRevision: number | null;
  /** Complete current set of dirty Catalog setting IDs owned by this form. */
  onDirtySettingIdsChange: (settingIds: readonly string[]) => void;
  /**
   * Exact Catalog settings requested by a bounded result projection. Undefined
   * means the complete manual tab. Only registrations that explicitly support
   * scoped projection receive this value.
   */
  settingIds?: readonly string[];
}
