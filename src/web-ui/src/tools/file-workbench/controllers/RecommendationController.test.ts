import { describe, expect, it } from 'vitest';
import { fileEntryFromFsEntry } from '../services/fileClassification';
import { getSelectionRecommendations } from './RecommendationController';

describe('RecommendationController', () => {
  it('marks organization as a plan-backed recommendation for folders', () => {
    const folder = fileEntryFromFsEntry({
      path: '/work/downloads',
      name: 'downloads',
      kind: 'dir',
      size: 0,
      readonly: false,
      hidden: false,
    }, { kind: 'system', root: '/work', permission: 'auto' });

    const recommendations = getSelectionRecommendations([folder]);

    expect(recommendations).toContainEqual({
      id: 'organize',
      priority: 'agent',
      requiresPlan: true,
    });
    expect(recommendations.map((item) => item.id)).toContain('openAsWorkspace');
  });
});
