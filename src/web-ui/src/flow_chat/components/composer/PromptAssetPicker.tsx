import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Search } from 'lucide-react';
import { Dialog, DialogBody, DialogHeader, Input, SelectableRow, Spinner } from '@/design-system';
import {
  PromptLibraryAPI,
  type PromptAssetSummary,
  type PromptAssetScope,
} from '@/infrastructure/api/service-api/PromptLibraryAPI';
import { useLastUsedWorkspace } from '@/infrastructure/contexts/WorkspaceContext';
import { createLogger } from '@/shared/utils/logger';
import './PromptAssetPicker.scss';

const log = createLogger('PromptAssetPicker');

export interface PromptAssetPickerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (asset: PromptAssetSummary) => void;
}

const SCOPE_LABELS: Record<PromptAssetScope, string> = {
  project: 'Project',
  workspace: 'Workspace',
  user: 'User',
};

const TEMPLATE_TYPE_LABELS: Record<string, string> = {
  custom: 'Custom',
  codeReview: 'Code Review',
  bugFix: 'Bug Fix',
  featureDesign: 'Feature Design',
  refactor: 'Refactor',
  testing: 'Testing',
  documentation: 'Documentation',
  architecture: 'Architecture',
  general: 'General',
};

export function PromptAssetPicker({ open, onOpenChange, onSelect }: PromptAssetPickerProps) {
  const { t } = useTranslation('scenes/prompt-library');
  const { workspacePath } = useLastUsedWorkspace();
  const [assets, setAssets] = useState<PromptAssetSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [scope, setScope] = useState<PromptAssetScope>('project');

  const loadAssets = useCallback(async () => {
    if (!workspacePath) return;
    setLoading(true);
    try {
      const result = await PromptLibraryAPI.listPromptAssets(workspacePath, scope);
      setAssets(result);
    } catch (err) {
      log.error('Failed to load prompt assets', { err });
      setAssets([]);
    } finally {
      setLoading(false);
    }
  }, [workspacePath, scope]);

  useEffect(() => {
    if (open) {
      loadAssets();
    }
  }, [open, loadAssets]);

  const filteredAssets = useMemo(() => {
    if (!searchQuery.trim()) return assets;
    const q = searchQuery.trim().toLowerCase();
    return assets.filter(
      a =>
        a.name.toLowerCase().includes(q) ||
        a.description?.toLowerCase().includes(q) ||
        a.tags.some(tag => tag.toLowerCase().includes(q))
    );
  }, [assets, searchQuery]);

  const handleSelect = useCallback(
    (asset: PromptAssetSummary) => {
      onSelect(asset);
      onOpenChange(false);
    },
    [onSelect, onOpenChange]
  );

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('picker.title', { defaultValue: 'Prompt Assets' })}
      size="medium"
      closeLabel={t('actions.cancel', { defaultValue: 'Close' })}
    >
      <DialogHeader title={t('picker.title', { defaultValue: 'Prompt Assets' })} />

      <DialogBody>
        <div className="prompt-asset-picker">
          <div className="prompt-asset-picker__header">
            <div className="prompt-asset-picker__search">
              <Search size={14} className="prompt-asset-picker__search-icon" />
              <Input
                className="prompt-asset-picker__search-input"
                placeholder={t('picker.searchPlaceholder', { defaultValue: 'Search prompts by name, description, or tags...' })}
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
              />
            </div>
            <div className="prompt-asset-picker__scope-filters">
              {(['project', 'workspace', 'user'] as PromptAssetScope[]).map(s => (
                <button
                  key={s}
                  className={`prompt-asset-picker__scope-btn ${scope === s ? 'prompt-asset-picker__scope-btn--active' : ''}`}
                  onClick={() => setScope(s)}
                >
                  {SCOPE_LABELS[s]}
                </button>
              ))}
            </div>
          </div>

          <div className="prompt-asset-picker__list">
            {loading ? (
              <div className="prompt-asset-picker__empty">
                <Spinner label={t('loading', { defaultValue: 'Loading...' })} size="small" />
              </div>
            ) : filteredAssets.length === 0 ? (
              <div className="prompt-asset-picker__empty">
                {searchQuery.trim()
                  ? t('picker.noResults', { defaultValue: 'No matching prompt assets found.' })
                  : t('picker.empty', { defaultValue: 'No prompt assets saved yet. Create one in the Prompt Library.' })}
              </div>
            ) : (
              filteredAssets.map(asset => (
                <SelectableRow
                  key={asset.id}
                  className="prompt-asset-picker__item"
                  onClick={() => handleSelect(asset)}
                  selected={false}
                  title={
                    <div className="prompt-asset-picker__item-header">
                      <span className="prompt-asset-picker__item-name">{asset.name}</span>
                      <span className="prompt-asset-picker__item-kind">
                        {TEMPLATE_TYPE_LABELS[asset.templateType] || asset.kind}
                      </span>
                    </div>
                  }
                >
                  {asset.description && (
                    <div className="prompt-asset-picker__item-desc">{asset.description}</div>
                  )}
                  {asset.tags.length > 0 && (
                    <div className="prompt-asset-picker__item-tags">
                      {asset.tags.map(tag => (
                        <span key={tag} className="prompt-asset-picker__tag">{tag}</span>
                      ))}
                    </div>
                  )}
                </SelectableRow>
              ))
            )}
          </div>
        </div>
      </DialogBody>
    </Dialog>
  );
}