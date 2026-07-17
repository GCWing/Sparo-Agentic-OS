import { Fragment, useMemo, useRef } from 'react';
import { ShieldCheck } from 'lucide-react';
import {
  Button,
  Dialog,
  DialogBody,
  DialogFooter,
} from '@/design-system';
import './CapabilityReviewDialog.scss';

type CapabilityGroupKey = 'ai' | 'files' | 'network' | 'session' | 'tools' | 'runtime' | 'other';

const CAPABILITY_GROUP_ORDER: CapabilityGroupKey[] = [
  'ai',
  'files',
  'network',
  'session',
  'tools',
  'runtime',
  'other',
];

interface CapabilityScope {
  permission: string;
  owners: string[];
  rawCapabilities: string[];
}

interface CapabilityGroup {
  key: CapabilityGroupKey;
  scopes: CapabilityScope[];
}

interface ParsedCapability {
  group: CapabilityGroupKey;
  permission: string;
  owner: string;
}

const OWNER_ACRONYMS = new Set(['ai', 'api', 'cli', 'os', 'ppt', 'ui', 'ux']);

function formatOwner(owner: string): string {
  if (!owner.includes('-') && !owner.includes('_')) return owner;

  return owner
    .replace(/^builtin-/, '')
    .split(/[-_]/)
    .filter(Boolean)
    .map((part) => OWNER_ACRONYMS.has(part.toLowerCase())
      ? part.toUpperCase()
      : `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(' ');
}

function permissionLabelKey(permission: string): string | null {
  const normalized = permission.toLowerCase();
  if (normalized === 'ai') return 'ai';
  if (normalized === 'model.invoke') return 'modelInvoke';
  if (normalized === 'session.read') return 'sessionRead';
  if (normalized === 'tool.invoke') return 'toolInvoke';
  if (normalized === 'component.run') return 'componentRun';
  if (normalized === 'filesystem') return 'filesystem';
  if (normalized === 'network') return 'network';
  if (normalized === 'fs:{appdata}') return 'appData';
  if (normalized === 'net:*') return 'networkAny';
  return null;
}

function capabilityGroup(capability: string): CapabilityGroupKey {
  const normalized = capability.toLowerCase();
  if (normalized === 'ai' || normalized.includes(':ai:') || normalized.includes('model.invoke')) {
    return 'ai';
  }
  if (normalized === 'filesystem' || normalized.includes(':fs:')) {
    return 'files';
  }
  if (normalized === 'network' || normalized.includes(':net:')) {
    return 'network';
  }
  if (normalized.includes('session.read')) {
    return 'session';
  }
  if (normalized.includes('tool.invoke')) {
    return 'tools';
  }
  if (normalized.includes('component.run')) {
    return 'runtime';
  }
  return 'other';
}

function parseCapability(capability: string, appOwner: string, systemOwner: string): ParsedCapability {
  const parts = capability.split(':');
  if (parts[0] === 'component' && parts.length >= 3) {
    const [, componentId, kind, ...rest] = parts;
    const detail = rest.join(':');
    const permission = kind === 'uses'
      ? detail
      : kind === 'ai'
        ? detail || kind
        : detail
          ? `${kind}:${detail}`
          : kind;
    return {
      group: capabilityGroup(capability),
      permission,
      owner: componentId,
    };
  }

  if (parts[0] === 'os' && parts.length > 1) {
    return {
      group: capabilityGroup(capability),
      permission: parts.slice(1).join(':'),
      owner: systemOwner,
    };
  }

  return {
    group: capabilityGroup(capability),
    permission: capability,
    owner: appOwner,
  };
}

function groupCapabilities(
  capabilities: string[],
  appOwner: string,
  systemOwner: string,
): CapabilityGroup[] {
  const groups = new Map<CapabilityGroupKey, Map<string, {
    owners: Set<string>;
    rawCapabilities: string[];
  }>>();

  capabilities.forEach((capability) => {
    const parsed = parseCapability(capability, appOwner, systemOwner);
    const scopes = groups.get(parsed.group) ?? new Map();
    const scope = scopes.get(parsed.permission) ?? {
      owners: new Set<string>(),
      rawCapabilities: [],
    };
    scope.owners.add(parsed.owner);
    scope.rawCapabilities.push(capability);
    scopes.set(parsed.permission, scope);
    groups.set(parsed.group, scopes);
  });

  return CAPABILITY_GROUP_ORDER.flatMap((key) => {
    const scopes = groups.get(key);
    if (!scopes) return [];
    return [{
      key,
      scopes: Array.from(scopes.entries()).map(([permission, scope]) => ({
        permission,
        owners: Array.from(scope.owners),
        rawCapabilities: scope.rawCapabilities,
      })),
    }];
  });
}

export interface CapabilityReviewDialogProps {
  open: boolean;
  title: string;
  description: string;
  scopeNote: string;
  capabilities: string[];
  approveText: string;
  cancelText: string;
  closeText: string;
  translationPrefix: string;
  t: (key: string, options?: Record<string, unknown>) => string;
  approving?: boolean;
  onClose: () => void;
  onApprove: () => void;
}

export function CapabilityReviewDialog({
  open,
  title,
  description,
  scopeNote,
  capabilities,
  approveText,
  cancelText,
  closeText,
  translationPrefix,
  t,
  approving = false,
  onClose,
  onApprove,
}: CapabilityReviewDialogProps) {
  const cancelButtonRef = useRef<HTMLButtonElement>(null);
  const groups = useMemo(() => groupCapabilities(
    capabilities,
    t(`${translationPrefix}.sources.app`),
    t(`${translationPrefix}.sources.system`),
  ), [capabilities, t, translationPrefix]);

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => { if (!nextOpen) onClose(); }}
      title={title}
      size="large"
      role="alertdialog"
      showDividers={false}
      initialFocusRef={cancelButtonRef}
      closeLabel={closeText}
    >
      <DialogBody className="capability-review-dialog__body">
        <p className="capability-review-dialog__intro">{description}</p>

        <div className="capability-review-dialog__table-region">
          <table className="capability-review-dialog__table" aria-label={title}>
            <thead>
              <tr>
                <th>{t(`${translationPrefix}.columns.capability`)}</th>
                <th>{t(`${translationPrefix}.columns.permission`)}</th>
                <th>{t(`${translationPrefix}.columns.usedBy`)}</th>
              </tr>
            </thead>
            <tbody>
              {groups.map((group) => (
                <Fragment key={group.key}>
                  {group.scopes.map((scope, scopeIndex) => {
                    const labelKey = permissionLabelKey(scope.permission);
                    return (
                      <tr key={`${group.key}-${scope.permission}`}>
                        {scopeIndex === 0 && (
                          <th scope="rowgroup" rowSpan={group.scopes.length}>
                            <span className="capability-review-dialog__capability-name">
                              {t(`${translationPrefix}.groups.${group.key}.title`)}
                            </span>
                            <span className="capability-review-dialog__capability-description">
                              {t(`${translationPrefix}.groups.${group.key}.description`)}
                            </span>
                          </th>
                        )}
                        <td>
                          <span className="capability-review-dialog__permission-name">
                            {labelKey
                              ? t(`${translationPrefix}.permissionLabels.${labelKey}`)
                              : scope.permission}
                          </span>
                          {labelKey && <code>{scope.permission}</code>}
                        </td>
                        <td>
                          <span
                            className="capability-review-dialog__owners"
                            title={scope.rawCapabilities.join('\n')}
                          >
                            {scope.owners.map(formatOwner).join(' · ')}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>

        <p className="capability-review-dialog__scope-note">{scopeNote}</p>
      </DialogBody>
      <DialogFooter className="capability-review-dialog__footer">
        <Button
          ref={cancelButtonRef}
          variant="secondary"
          size="small"
          onClick={onClose}
          disabled={approving}
        >
          {cancelText}
        </Button>
        <Button
          variant="primary"
          size="small"
          onClick={onApprove}
          disabled={approving}
          isLoading={approving}
        >
          <ShieldCheck size={14} aria-hidden />
          {approveText}
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
