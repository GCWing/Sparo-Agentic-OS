import { browser, expect } from '@wdio/globals';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const NO_USER_MATERIAL_LETTER_REGRESSIONS = [
  /没有对话[^\n。]*没有代码/,
  /没有[^\n。]*(对话|代码|Work)/,
  /今天什么都没发生/,
  /今日无事/,
  /无甚可记/,
  /一天将尽/,
  /安静的一天/,
  /间隙|工具沉默|不动手/,
  /没有新的工作痕迹/,
  /桌面[^\n。]*痕迹/,
  /工具[^\n。]*(留下|痕迹)/,
  /没有[^\n。]*工作痕迹/,
  /没有需要记录/,
  /没什么[^\n。]*(记|记录|可写)/,
  /没有什么[^\n。]*(记|记录|可写)/,
  /值得记录/,
  /不勉强[^\n。]*(留下|记录)/,
  /明天见|晚安/,
  /Sparo OS|后台|机器|Warot|Runno/,
  /昨天|明天/,
  /没有代码[^\n。]*新的\s*Work/,
  /工作区[^\n。]*例行初始化/,
  /凌晨[^\n。]*初始化/,
  /空会话/,
  /bitfun-coder/i,
  /orphaned execution interrupted/i,
  /流式中断/,
  /清理策略/,
  /E2E\s*测试[^\n。]*(留下|之后)/,
  /那些线索/,
  /不急/,
  /(空白|沉默|安静)的日子/,
  /安静[^\n。]*(节奏|本身|过了|过去)/,
  /留白/,
  /不需要被填满/,
  /不是每一天/,
  /没有被迫/,
  /未被|未说破|不需要今天|不需要[^\n。]*(抵达|到达)/,
  /为自己保留/,
  /最好的形状不是/,
  /做了什么/,
  /追赶/,
  /不是空的/,
  /把意义还给了你/,
  /工具调用|调用日志|日志|sourcePath|daily_summaries|workspace|workspaces|LS|Glob|rg/i,
  /no conversation[^\n.]*no code/i,
  /workspace[^\n.]*initialization/i,
  /session shell/i,
];

const ORIENTATION_DAY_AUDIT_REGRESSIONS = [
  /没有[^\n。]*(代码变更|文件操作|工程产出|分析报告|命令)/,
  /没有[^\n。]*(产出|代码|文件|产物|任务体量)/,
  /(很短|短|轻量)[^\n。]*(但|但是)/,
  /这不是/,
  /不是[^\n。]*一天/,
  /什么都没做/,
  /没有更多/,
  /只有[^\n。]*(几句|句|段|一点)/,
  /简短|短短/,
  /所有工作区[^\n。]*(归档|封存|安静)/,
  /痕迹[^\n。]*这么多/,
  /自然的留白/,
  /no (code changes|file operations|engineering output|commands|reports)/i,
  /Work[^\n。]*(处于活跃状态|active)/i,
  /scope[^\n。]*(指向|points to)/i,
];

interface DailyLetterGenerationResult {
  ok: boolean;
  done?: boolean;
  error?: string;
}

interface DailyLetterDiskRecord {
  date: string;
  status: string;
  bodyMarkdown: string;
  updatedAtMs: number;
  preview?: {
    oneLine?: string | null;
  };
}

interface DailyLetterState {
  lastAttemptedDate?: string | null;
  lastAttemptStartedAtMs?: number | null;
  lastAttemptStatus?: string | null;
  lastError?: string | null;
}

type DailyLetterRunWindow = Window & {
  __dailyLetterRuns?: Record<string, DailyLetterGenerationResult>;
};

function dailyLetterRoot(): string {
  const appData = process.env.APPDATA ?? path.join(os.homedir(), 'AppData', 'Roaming');
  return path.join(appData, 'sparo_os', 'agentic_os', 'daily_letters');
}

function dailyLetterRecordPath(date: string): string {
  return path.join(dailyLetterRoot(), date.slice(0, 4), `${date}.json`);
}

function dailyLetterStatePath(): string {
  return path.join(dailyLetterRoot(), 'state.json');
}

function readJsonFile<T>(filePath: string): T | null {
  if (!fs.existsSync(filePath)) {
    return null;
  }
  return JSON.parse(fs.readFileSync(filePath, 'utf8')) as T;
}

async function startDailyLetterGeneration(date: string): Promise<void> {
  await browser.execute((targetDate: string) => {
    const runWindow = window as DailyLetterRunWindow;
    runWindow.__dailyLetterRuns = runWindow.__dailyLetterRuns ?? {};
    runWindow.__dailyLetterRuns[targetDate] = { ok: true, done: false };

    (async () => {
      const dailyLetterApiModulePath = '/src/app/scenes/daily-letter/dailyLetterApi.ts';
      const { dailyLetterApi } = await import(/* @vite-ignore */ dailyLetterApiModulePath);
      await dailyLetterApi.generate({
        date: targetDate,
        scope: 'agentic_os',
        workspacePath: null,
        force: true,
      });
      runWindow.__dailyLetterRuns![targetDate] = { ok: true, done: true };
    })().catch((error: unknown) => {
      runWindow.__dailyLetterRuns![targetDate] = {
        ok: false,
        done: true,
        error: error instanceof Error ? error.message : String(error),
      };
    });

    return true;
  }, date);
}

async function waitForDailyLetterRecord(date: string, startedAtMs: number): Promise<DailyLetterDiskRecord> {
  const deadline = Date.now() + 30 * 60 * 1000;
  const recordPath = dailyLetterRecordPath(date);
  const statePath = dailyLetterStatePath();

  while (Date.now() < deadline) {
    const record = readJsonFile<DailyLetterDiskRecord>(recordPath);
    if (record?.date === date && record.updatedAtMs >= startedAtMs) {
      return record;
    }

    const state = readJsonFile<DailyLetterState>(statePath);
    const attemptStartedAt = state?.lastAttemptStartedAtMs ?? 0;
    const status = state?.lastAttemptStatus;
    if (state?.lastAttemptedDate === date && attemptStartedAt >= startedAtMs && status === 'error') {
      throw new Error(`Daily Letter generation failed: ${state.lastError ?? 'unknown error'}`);
    }

    await new Promise(resolve => setTimeout(resolve, 5000));
  }

  throw new Error(`Daily Letter generation timed out for ${date}`);
}

async function generateDailyLetterForDate(date: string): Promise<DailyLetterDiskRecord> {
  const startedAtMs = Date.now();
  await startDailyLetterGeneration(date);
  return waitForDailyLetterRecord(date, startedAtMs);
}

describe('Daily Letter generation', function () {
  this.timeout(2400000);

  before(async function () {
    this.timeout(2400000);
    await browser.setTimeout({ script: 120000 });
  });

  it('handles no-user-material and orientation-material days in one generation pass', async function () {
    const noUserMaterialRecord = await generateDailyLetterForDate('2026-07-07');
    const noUserMaterialBody = noUserMaterialRecord.bodyMarkdown.replace(/\s+/g, ' ').trim();
    const noUserMaterialPreview = (noUserMaterialRecord.preview?.oneLine ?? '').replace(/\s+/g, ' ').trim();
    console.log('[DailyLetter] Generated 2026-07-07 status:', noUserMaterialRecord.status);
    console.log('[DailyLetter] Generated 2026-07-07 preview:', noUserMaterialPreview);
    console.log('[DailyLetter] Generated 2026-07-07 body:', noUserMaterialBody);

    expect(noUserMaterialRecord.status).toBe('insufficient_context');
    expect(noUserMaterialBody.length).toBeGreaterThan(0);
    for (const pattern of NO_USER_MATERIAL_LETTER_REGRESSIONS) {
      expect(noUserMaterialBody).not.toMatch(pattern);
      expect(noUserMaterialPreview).not.toMatch(pattern);
    }

    const orientationRecord = await generateDailyLetterForDate('2026-07-05');
    const orientationBody = orientationRecord.bodyMarkdown.replace(/\s+/g, ' ').trim();
    const orientationPreview = (orientationRecord.preview?.oneLine ?? '').replace(/\s+/g, ' ').trim();
    console.log('[DailyLetter] Generated 2026-07-05 status:', orientationRecord.status);
    console.log('[DailyLetter] Generated 2026-07-05 preview:', orientationPreview);
    console.log('[DailyLetter] Generated 2026-07-05 body:', orientationBody);

    expect(orientationRecord.date).toBe('2026-07-05');
    expect(orientationRecord.status).not.toBe('insufficient_context');
    expect(orientationBody.length).toBeGreaterThan(40);
    expect(orientationBody).toMatch(/Runno|BitFun Coder|智能体|agent|能力|边界|角色/);
    for (const pattern of ORIENTATION_DAY_AUDIT_REGRESSIONS) {
      expect(orientationBody).not.toMatch(pattern);
      expect(orientationPreview).not.toMatch(pattern);
    }
  });
});
