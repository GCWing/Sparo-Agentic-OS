import { beforeEach, describe, expect, it } from 'vitest';
import { useExcelLiveLaunchStore } from './excelLiveLaunchStore';

describe('Excel Live launch binding', () => {
  beforeEach(() => {
    useExcelLiveLaunchStore.setState({ pendingPaths: {} });
  });

  it('keeps concurrent file launches isolated by runtime entity', () => {
    const store = useExcelLiveLaunchStore.getState();
    store.setPendingPath('excel-file:A.xlsx', 'A.xlsx');
    store.setPendingPath('excel-file:B.xlsx', 'B.xlsx');

    expect(store.consumePendingPath('excel-file:A.xlsx')).toBe('A.xlsx');
    expect(useExcelLiveLaunchStore.getState().peekPendingPath('excel-file:B.xlsx')).toBe('B.xlsx');
    expect(useExcelLiveLaunchStore.getState().peekPendingPath('excel-file:A.xlsx')).toBeNull();
  });

  it('does not let an older navigation clear a newer launch for the same file', () => {
    const store = useExcelLiveLaunchStore.getState();
    store.setPendingPath('excel-file:A.xlsx', 'A.xlsx', 'owner-a');
    store.setPendingPath('excel-file:A.xlsx', 'A.xlsx', 'owner-b');

    store.clearPendingPath('excel-file:A.xlsx', 'owner-a');

    expect(useExcelLiveLaunchStore.getState().peekPendingPath('excel-file:A.xlsx')).toBe('A.xlsx');
    store.clearPendingPath('excel-file:A.xlsx', 'owner-b');
    expect(useExcelLiveLaunchStore.getState().peekPendingPath('excel-file:A.xlsx')).toBeNull();
  });
});
