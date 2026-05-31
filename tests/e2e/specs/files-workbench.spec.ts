import fs from 'node:fs/promises';
import path from 'node:path';
import { browser, expect, $, $$ } from '@wdio/globals';
import { openWorkspace } from '../helpers/workspace-helper';

async function openFilesHome(): Promise<void> {
  await browser.waitUntil(async () => {
    await browser.execute(async () => {
      const { openWorkspaceScene } = await import('/src/app/navigation/workspaceNavigation.ts');
      openWorkspaceScene('file-viewer', { workspacePath: null });
    });

    const scenes = await $$('.sparo-files-scene');
    return scenes.length > 0 && await scenes[0].isDisplayed();
  }, {
    timeout: 15000,
    interval: 500,
    timeoutMsg: 'Files scene did not open',
  });

  const scene = await $('.sparo-files-scene');
  await scene.waitForDisplayed({
    timeout: 5000,
    timeoutMsg: 'Files scene did not open',
  });
}

async function openFirstSystemLocation(): Promise<void> {
  await browser.waitUntil(async () => {
    const quickFolders = await $$('[data-testid="files-quick-folder"]');
    const drives = await $$('[data-testid="files-drive"]');
    return quickFolders.length > 0 || drives.length > 0;
  }, {
    timeout: 15000,
    interval: 500,
    timeoutMsg: 'System file roots did not render',
  });

  const quickFolders = await $$('[data-testid="files-quick-folder"]');
  if (quickFolders.length > 0) {
    await quickFolders[0].click();
    return;
  }

  const drives = await $$('[data-testid="files-drive"]');
  expect(drives.length).toBeGreaterThan(0);
  await drives[0].click();
}

async function waitForBrowserEntries(): Promise<WebdriverIO.Element[]> {
  await browser.waitUntil(async () => {
    const entries = await $$('[data-testid="files-browser-entry"]');
    return entries.length > 0;
  }, {
    timeout: 15000,
    interval: 500,
    timeoutMsg: 'Files browser did not render entries',
  });

  return $$('[data-testid="files-browser-entry"]');
}

async function openSystemPath(pathValue: string): Promise<void> {
  const search = await $('[data-testid="files-browser-search"]');
  if (await search.isExisting()) {
    await search.setValue('');
  }
  const addressButton = await $('[data-testid="files-address-button"]');
  await addressButton.click();
  const addressInput = await $('[data-testid="files-address-input"]');
  await addressInput.waitForDisplayed({
    timeout: 5000,
    timeoutMsg: 'Files address input did not render',
  });
  await addressInput.setValue(pathValue);
  await browser.keys('Enter');
}

async function pathExists(pathValue: string): Promise<boolean> {
  try {
    await fs.access(pathValue);
    return true;
  } catch {
    return false;
  }
}

describe('Files workbench browser', () => {
  it('previews, searches, and multi-selects system browser entries', async () => {
    const opened = await openWorkspace();
    expect(opened).toBe(true);

    await openFilesHome();
    await browser.waitUntil(async () => {
      const smartCollections = await $$('[data-testid="files-smart-collection"]');
      return smartCollections.length > 0;
    }, {
      timeout: 10000,
      interval: 500,
      timeoutMsg: 'Smart Collections did not render',
    });
    const smartCollections = await $$('[data-testid="files-smart-collection"]');
    expect(smartCollections.length).toBeGreaterThan(0);

    await openFirstSystemLocation();

    const entries = await waitForBrowserEntries();
    const folderEntries = await $$('[data-testid="files-browser-entry"][data-category="folder"]');
    const primaryEntry = folderEntries[0] ?? entries[0];
    const firstEntryText = await primaryEntry.getText();
    expect(firstEntryText.length).toBeGreaterThan(0);

    await primaryEntry.click();

    const workbench = await $('[data-testid="files-workbench-pane"]');
    await workbench.waitForDisplayed({
      timeout: 10000,
      timeoutMsg: 'Workbench pane did not render',
    });
    await browser.waitUntil(async () => {
      const text = await workbench.getText();
      return text.includes(firstEntryText.split(/\s+/)[0]);
    }, {
      timeout: 10000,
      interval: 500,
      timeoutMsg: 'Workbench did not reflect selected entry',
    });

    const recentPaths = await $('[data-testid="files-recent-paths"]');
    await recentPaths.waitForDisplayed({
      timeout: 10000,
      timeoutMsg: 'Recent file paths did not render after opening a system location',
    });

    const operationPlan = await $('[data-testid="files-operation-plan"]');
    await operationPlan.waitForDisplayed({
      timeout: 10000,
      timeoutMsg: 'Workbench did not render a reviewed operation plan',
    });
    await browser.waitUntil(async () => {
      const text = await operationPlan.getText();
      return !text.includes('Command file_workbench_plan_operations not found')
        && !text.includes('Unable to generate plan')
        && !text.includes('无法生成计划');
    }, {
      timeout: 10000,
      interval: 500,
      timeoutMsg: 'Workbench rendered an operation plan error instead of a reviewed plan',
    });

    if (entries.length > 1) {
      await browser.execute(() => {
        const second = document.querySelectorAll('[data-testid="files-browser-entry"]')[1];
        second?.dispatchEvent(new MouseEvent('click', {
          bubbles: true,
          cancelable: true,
          ctrlKey: true,
        }));
      });

      await browser.waitUntil(async () => {
        const selected = await $$('[data-testid="files-browser-entry"][aria-selected="true"]');
        return selected.length >= 2;
      }, {
        timeout: 5000,
        interval: 250,
        timeoutMsg: 'Ctrl multi-select did not select at least two entries',
      });
    }

    const search = await $('[data-testid="files-browser-search"]');
    await search.setValue(firstEntryText.slice(0, Math.min(3, firstEntryText.length)));

    await browser.waitUntil(async () => {
      const filteredEntries = await $$('[data-testid="files-browser-entry"]');
      return filteredEntries.length > 0;
    }, {
      timeout: 5000,
      interval: 250,
      timeoutMsg: 'Files browser search removed all entries unexpectedly',
    });
  });

  it('executes and restores a recoverable file operation plan', async () => {
    const tempRoot = path.join(process.cwd(), 'tmp', `files-workbench-${Date.now()}`);
    const tempFile = path.join(tempRoot, 'recoverable-note.txt');
    await fs.mkdir(tempRoot, { recursive: true });
    await fs.writeFile(tempFile, 'recoverable file workbench e2e', 'utf8');

    try {
      const opened = await openWorkspace();
      expect(opened).toBe(true);

      await openFilesHome();
      const execution = await browser.execute(async ({ root, file }) => {
        const { fileWorkbenchAPI, systemFsAPI } = await import('/src/infrastructure/api/index.ts');
        const stat = await systemFsAPI.stat(file);
        const entry = {
          id: file,
          path: file,
          name: stat.name,
          kind: stat.kind,
          scope: { kind: 'system' as const, root },
          size: stat.size,
          modifiedAt: stat.modified,
          category: 'text',
          hidden: stat.hidden,
          readonly: stat.readonly,
        };
        const plan = await fileWorkbenchAPI.planOperations({
          scope: { kind: 'system', root },
          cwd: root,
          selection: [entry],
          intent: {
            title: 'Recoverable cleanup',
            operationType: 'delete-to-trash',
            reason: 'E2E recoverable cleanup',
          },
        });
        const audit = await fileWorkbenchAPI.executePlan({
          plan,
          confirmationToken: `confirm:${plan.id}`,
        });
        const recoverable = audit.results.find((result) => result.success && result.recovery);
        let movedOut = false;
        let restoredSuccess = false;
        if (recoverable) {
          try {
            await systemFsAPI.stat(file);
          } catch {
            movedOut = true;
          }
          const restored = await fileWorkbenchAPI.restoreAuditItem({
            planId: audit.planId,
            itemId: recoverable.itemId,
            confirmationToken: `restore:${audit.planId}`,
          });
          restoredSuccess = restored.success;
        }
        return {
          planId: plan.id,
          auditSuccess: audit.success,
          firstResult: audit.results[0],
          hasRecovery: Boolean(recoverable),
          movedOut,
          restoredSuccess,
        };
      }, { root: tempRoot, file: tempFile });

      expect(execution.auditSuccess).toBe(true);
      if (!execution.hasRecovery) {
        throw new Error(`Executed audit did not include recovery metadata: ${JSON.stringify(execution.firstResult)}`);
      }
      expect(execution.movedOut).toBe(true);
      expect(execution.restoredSuccess).toBe(true);
      expect(await pathExists(tempFile)).toBe(true);
    } finally {
      await fs.rm(tempRoot, { recursive: true, force: true });
    }
  });

  it('executes reusable copy, archive, and extract operation plans', async () => {
    const tempRoot = path.join(process.cwd(), 'tmp', `files-workbench-ops-${Date.now()}`);
    const copySource = path.join(tempRoot, 'copy-source');
    const copyNested = path.join(copySource, 'nested');
    const copyFile = path.join(copyNested, 'note.txt');
    const copyTargetRoot = path.join(tempRoot, 'copied');
    const archiveFile = path.join(tempRoot, 'bundle-note.txt');
    const archivePath = path.join(tempRoot, 'bundle-note.zip');
    const extractTargetRoot = path.join(tempRoot, 'extracted');
    const extractedFile = path.join(extractTargetRoot, 'bundle-note', 'bundle-note.txt');

    await fs.mkdir(copyNested, { recursive: true });
    await fs.writeFile(copyFile, 'copy directory e2e', 'utf8');
    await fs.writeFile(archiveFile, 'archive extract e2e', 'utf8');

    try {
      const opened = await openWorkspace();
      expect(opened).toBe(true);

      await openFilesHome();
      const execution = await browser.execute(async ({
        root,
        copySourcePath,
        copyTarget,
        archiveSourcePath,
        archiveOutputPath,
        extractTarget,
      }) => {
        const { fileWorkbenchAPI, systemFsAPI } = await import('/src/infrastructure/api/index.ts');
        const makeEntry = async (filePath: string) => {
          const stat = await systemFsAPI.stat(filePath);
          return {
            id: filePath,
            path: filePath,
            name: stat.name,
            kind: stat.kind,
            scope: { kind: 'system' as const, root },
            size: stat.size,
            modifiedAt: stat.modified,
            category: stat.kind === 'dir' ? 'folder' : 'text',
            hidden: stat.hidden,
            readonly: stat.readonly,
          };
        };
        const execute = async (
          title: string,
          operationType: 'copy' | 'archive' | 'extract',
          filePath: string,
          targetDir?: string,
        ) => {
          const plan = await fileWorkbenchAPI.planOperations({
            scope: { kind: 'system', root },
            cwd: root,
            selection: [await makeEntry(filePath)],
            intent: {
              title,
              operationType,
              targetDir,
              reason: `${title} e2e`,
            },
          });
          return fileWorkbenchAPI.executePlan({
            plan,
            confirmationToken: `confirm:${plan.id}`,
          });
        };

        const copyAudit = await execute('Copy directory', 'copy', copySourcePath, copyTarget);
        const archiveAudit = await execute('Archive file', 'archive', archiveSourcePath, root);
        const archiveStat = await systemFsAPI.stat(archiveOutputPath);
        const extractAudit = await execute('Extract file', 'extract', archiveOutputPath, extractTarget);

        return {
          copySuccess: copyAudit.success,
          archiveSuccess: archiveAudit.success,
          archiveKind: archiveStat.kind,
          extractSuccess: extractAudit.success,
        };
      }, {
        root: tempRoot,
        copySourcePath: copySource,
        copyTarget: copyTargetRoot,
        archiveSourcePath: archiveFile,
        archiveOutputPath: archivePath,
        extractTarget: extractTargetRoot,
      });

      expect(execution.copySuccess).toBe(true);
      expect(execution.archiveSuccess).toBe(true);
      expect(execution.archiveKind).toBe('file');
      expect(execution.extractSuccess).toBe(true);
      expect(await fs.readFile(path.join(copyTargetRoot, 'copy-source', 'nested', 'note.txt'), 'utf8')).toBe('copy directory e2e');
      expect(await fs.readFile(extractedFile, 'utf8')).toBe('archive extract e2e');
    } finally {
      await fs.rm(tempRoot, { recursive: true, force: true });
    }
  });

  it('imports an agent-created operation plan into Files for review', async () => {
    const tempRoot = path.join(process.cwd(), 'tmp', `files-workbench-agent-plan-${Date.now()}`);
    const tempFile = path.join(tempRoot, 'agent-plan-note.txt');
    await fs.mkdir(tempRoot, { recursive: true });
    await fs.writeFile(tempFile, 'agent plan review e2e', 'utf8');

    try {
      const opened = await openWorkspace();
      expect(opened).toBe(true);

      await openFilesHome();
      const planTitle = await browser.execute(async ({ root, file }) => {
        const { openWorkspaceScene } = await import('/src/app/navigation/workspaceNavigation.ts');
        const { fileWorkbenchAPI, systemFsAPI } = await import('/src/infrastructure/api/index.ts');
        const { dispatchFileWorkbenchPlanReview } = await import('/src/tools/file-workbench/services/fileWorkbenchEvents.ts');
        const stat = await systemFsAPI.stat(file);
        const plan = await fileWorkbenchAPI.planOperations({
          scope: { kind: 'system', root },
          cwd: root,
          selection: [{
            id: file,
            path: file,
            name: stat.name,
            kind: stat.kind,
            scope: { kind: 'system' as const, root },
            size: stat.size,
            modifiedAt: stat.modified,
            category: 'text',
            hidden: stat.hidden,
            readonly: stat.readonly,
          }],
          intent: {
            title: 'Agent reviewed archive',
            operationType: 'archive',
            reason: 'E2E agent hands plan to Files',
          },
        });
        openWorkspaceScene('file-viewer', { workspacePath: null });
        dispatchFileWorkbenchPlanReview({ plan, source: 'tool-card' });
        return plan.title;
      }, { root: tempRoot, file: tempFile });

      const operationPlan = await $('[data-testid="files-operation-plan"]');
      await operationPlan.waitForDisplayed({
        timeout: 10000,
        timeoutMsg: 'Files did not render the imported agent operation plan',
      });
      await browser.waitUntil(async () => {
        const text = await operationPlan.getText();
        return text.includes(planTitle) && text.includes('1');
      }, {
        timeout: 10000,
        interval: 500,
        timeoutMsg: 'Imported operation plan did not remain visible for review',
      });
    } finally {
      await fs.rm(tempRoot, { recursive: true, force: true });
    }
  });
});
