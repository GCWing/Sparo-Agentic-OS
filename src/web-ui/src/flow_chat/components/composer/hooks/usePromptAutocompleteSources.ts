import { useState, useEffect, useMemo } from 'react';
import { PromptTrie } from '../../../utils/promptTrie';
import { PromptLibraryAPI, type PromptAssetSummary, type PromptHistoryEvent } from '@/infrastructure/api/service-api/PromptLibraryAPI';
import type { HistoryEntry } from '../../../store/inputHistoryStore';

export interface PromptEntry {
  /** The full prompt text (trimmed). */
  text: string;
  /** Millisecond timestamp. Infinity for asset entries so they always sort first. */
  timestamp: number;
  /** When true the entry is a prompt asset and is excluded from eviction. */
  isAsset: boolean;
}

export interface UnifiedAutocompleteResult {
  /** The ghost-text completion (null when no match). */
  suggestion: string | null;
  /** Whether the async sources (assets + workspace history) have finished loading. */
  loaded: boolean;
}

interface UsePromptAutocompleteSourcesParams {
  /** Current workspace path. When falsy, async sources are skipped. */
  workspacePath: string | undefined;
  /** Session input history (with timestamps), most recent first. */
  sessionEntries: HistoryEntry[];
  /** Current raw input value to match against. */
  inputValue: string;
}

/** Maximum number of non-asset entries kept in the trie. */
const MAX_HISTORY_ENTRIES = 1000;

/**
 * Unified hook that merges three sources into a single PromptTrie:
 *
 * 1. Prompt assets (always included, highest priority, never evicted).
 * 2. Workspace prompt history (loaded from backend, up to 1000 most recent events).
 * 3. Session input history (already in-memory from Zustand localStorage store).
 *
 * Sources are merged, deduplicated (same text → keep newest timestamp, asset flag OR'd),
 * and non-asset entries are evicted to MAX_HISTORY_ENTRIES by timestamp.
 *
 * On every change the trie is rebuilt from scratch in a useMemo — no persistence,
 * no incremental updates.  The trie depth is hard-coded at 30 code points.
 */
export function usePromptAutocompleteSources({
  workspacePath,
  sessionEntries,
  inputValue,
}: UsePromptAutocompleteSourcesParams): UnifiedAutocompleteResult {
  const [assetSummaries, setAssetSummaries] = useState<PromptAssetSummary[]>([]);
  const [historyEvents, setHistoryEvents] = useState<PromptHistoryEvent[]>([]);
  const [loaded, setLoaded] = useState(false);

  // ── Assets ────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!workspacePath) {
      setAssetSummaries([]);
      return;
    }

    let cancelled = false;

    void (async () => {
      try {
        const [project, ws, user] = await Promise.all([
          PromptLibraryAPI.listPromptAssets(workspacePath, 'project').catch(() => [] as PromptAssetSummary[]),
          PromptLibraryAPI.listPromptAssets(workspacePath, 'workspace').catch(() => [] as PromptAssetSummary[]),
          PromptLibraryAPI.listPromptAssets(workspacePath, 'user').catch(() => [] as PromptAssetSummary[]),
        ]);

        if (!cancelled) {
          setAssetSummaries([...project, ...ws, ...user]);
        }
      } catch {
        if (!cancelled) {
          setAssetSummaries([]);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [workspacePath]);

  // ── Workspace history ─────────────────────────────────────────────────────
  useEffect(() => {
    if (!workspacePath) {
      setHistoryEvents([]);
      return;
    }

    let cancelled = false;

    void (async () => {
      try {
        const summary = await PromptLibraryAPI.listPromptHistory({
          workspacePath,
          limit: 1000,
        });

        if (!cancelled) {
          setHistoryEvents(summary.events);
        }
      } catch {
        if (!cancelled) {
          setHistoryEvents([]);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [workspacePath]);

  // ── Mark as loaded ────────────────────────────────────────────────────────
  useEffect(() => {
    setLoaded(true);
  }, []);

  // ── Build unified PromptEntry list ────────────────────────────────────────
  const unifiedEntries = useMemo<PromptEntry[]>(() => {
    const map = new Map<string, PromptEntry>();

    // ---- Assets (highest effective priority — timestamp Infinity) ----
    for (const asset of assetSummaries) {
      const text = asset.name.trim();
      if (!text) continue;
      const existing = map.get(text);
      if (!existing) {
        map.set(text, { text, timestamp: Infinity, isAsset: true });
      } else {
        existing.isAsset = true;
      }
    }

    // ---- Workspace history ----
    for (const event of historyEvents) {
      const text = event.text.trim();
      if (!text) continue;
      const ts = Date.parse(event.createdAt);
      const timestamp = Number.isFinite(ts) ? ts : 0;
      const existing = map.get(text);
      if (!existing) {
        map.set(text, { text, timestamp, isAsset: false });
      } else {
        // Keep the newer timestamp; keep asset flag.
        if (timestamp > existing.timestamp) {
          existing.timestamp = timestamp;
        }
      }
    }

    // ---- Session history ----
    for (const entry of sessionEntries) {
      const text = entry.text.trim();
      if (!text) continue;
      const existing = map.get(text);
      if (!existing) {
        map.set(text, { text, timestamp: entry.timestamp, isAsset: false });
      } else {
        if (entry.timestamp > existing.timestamp) {
          existing.timestamp = entry.timestamp;
        }
      }
    }

    // Separate assets and history.
    const assets: PromptEntry[] = [];
    const history: PromptEntry[] = [];
    for (const entry of map.values()) {
      if (entry.isAsset) {
        assets.push(entry);
      } else {
        history.push(entry);
      }
    }

    // Evict non-asset entries beyond MAX_HISTORY_ENTRIES (keep newest).
    history.sort((a, b) => b.timestamp - a.timestamp);
    const keptHistory = history.slice(0, MAX_HISTORY_ENTRIES);

    // Assets first (earliest-wins → highest priority), then history (newest first).
    return [...assets, ...keptHistory];
  }, [assetSummaries, historyEvents, sessionEntries]);

  // ── Build trie ───────────────────────────────────────────────────────────
  const trie = useMemo(() => {
    const t = new PromptTrie();
    t.insertAll(unifiedEntries.map((e) => e.text));
    return t;
  }, [unifiedEntries]);

  // ── Query trie ───────────────────────────────────────────────────────────
  const suggestion = useMemo(() => {
    const trimmed = inputValue.trim();
    if (!trimmed) return null;
    return trie.autocomplete(trimmed);
  }, [trie, inputValue]);

  return { suggestion, loaded };
}