/**
 * Trigram-based substring index for prompt autocomplete.
 *
 * Each entry is decomposed into overlapping 3-character trigrams,
 * stored in an inverted index (trigram → candidate entry indices).
 * At query time, the shortest posting list drives candidate verification
 * via `String.includes()`.
 *
 * Short entries (< 3 chars) get a synthetic key for direct lookup.
 * Short queries (< 3 chars) fall back to a linear scan to avoid
 * the ambiguity inherent in querying with fewer than 3 characters.
 *
 * No dependency on locale-aware segmentation — we use `String.slice()`
 * which operates on UTF-16 code units and is correct for BMP characters
 * (including all of CJK Unified Ideographs). Astral-plane characters
 * (emoji, rare hanzi) may produce surrogate halves in trigrams, but the
 * final `includes()` verification always resolves correctly.
 */

export interface SubstringQueryResult {
  /** The best-matching full entry text, or null. */
  text: string | null;
  /** Whether this was a prefix match (used for ghost-tail rendering). */
  matchType: 'prefix' | 'substring' | null;
}

interface IndexEntry {
  text: string;
  isAsset: boolean;
  timestamp: number;
}

/**
 * Minimum characters required before triggering a substring query.
 * Below this the signal-to-noise ratio is too low.
 */
const MIN_QUERY_LENGTH = 2;

/**
 * Maximum number of candidates to verify with `includes()` per query.
 * Guards against degenerate cases where a very common trigram matches
 * nearly every entry.
 */
const MAX_CANDIDATE_VERIFY = 300;

export class SubstringIndex {
  private trigramMap: Map<string, number[]>;
  private entries: IndexEntry[];

  /**
   * @param entries  Ordered by descending priority (asset entries first,
   *                 then workspace history newest-first).
   */
  constructor(entries: IndexEntry[]) {
    this.entries = entries;
    this.trigramMap = new Map();
    this._build();
  }

  // ── Public API ──────────────────────────────────────────────────────────

  /**
   * Query the index for entries that contain `input` as a substring.
   * Returns the best match (ranked by prefix > position > asset > recency > brevity)
   * or null when no entry qualifies.
   */
  query(input: string): SubstringQueryResult {
    const trimmed = input.trim();
    if (trimmed.length < MIN_QUERY_LENGTH) {
      return { text: null, matchType: null };
    }

    // Check for an exact prefix match first — this is the most precise signal.
    const prefixMatch = this._prefixScan(trimmed);
    if (prefixMatch !== null) {
      return { text: prefixMatch, matchType: 'prefix' };
    }

    // Substring fallback.
    const candidates = trimmed.length < 3
      ? this._linearScan(trimmed)
      : this._trigramScan(trimmed);

    if (candidates.length === 0) {
      return { text: null, matchType: null };
    }

    const best = this._rank(trimmed, candidates);
    return { text: best, matchType: 'substring' };
  }

  /** Number of trigram keys in the index (for debugging). */
  keyCount(): number {
    return this.trigramMap.size;
  }

  // ── Build ───────────────────────────────────────────────────────────────

  private _build(): void {
    for (let i = 0; i < this.entries.length; i++) {
      const text = this.entries[i].text;
      if (text.length < 3) {
        // Synthetic key for short entries so they can still be discovered
        // by the trigram pathway when the query is >= 3 chars.
        if (text.length > 0) {
          const key = `\0${text}`;
          this._add(key, i);
        }
        continue;
      }

      const seen = new Set<string>();
      for (let j = 0; j <= text.length - 3; j++) {
        const trigram = text.slice(j, j + 3);
        if (seen.has(trigram)) continue;
        seen.add(trigram);
        this._add(trigram, i);
      }
    }
  }

  private _add(key: string, entryIndex: number): void {
    let list = this.trigramMap.get(key);
    if (!list) {
      list = [];
      this.trigramMap.set(key, list);
    }
    list.push(entryIndex);
  }

  // ── Query helpers ───────────────────────────────────────────────────────

  /** Fast prefix scan — O(n) but exits early via first-match (entries are pre-sorted). */
  private _prefixScan(input: string): string | null {
    for (const entry of this.entries) {
      if (entry.text.startsWith(input)) {
        return entry.text;
      }
    }
    return null;
  }

  /** Trigram-driven candidate lookup + verification. */
  private _trigramScan(input: string): number[] {
    // Extract all trigrams from the query.
    const queryTrigrams: string[] = [];
    for (let i = 0; i <= input.length - 3; i++) {
      queryTrigrams.push(input.slice(i, i + 3));
    }

    if (queryTrigrams.length === 0) return [];

    // Pick the trigram with the smallest posting list as the driver.
    let bestList: number[] | null = null;
    let bestSize = Infinity;
    for (const tg of queryTrigrams) {
      const list = this.trigramMap.get(tg);
      if (!list) return []; // One missing trigram → no possible match
      if (list.length < bestSize) {
        bestList = list;
        bestSize = list.length;
      }
    }

    if (!bestList) return [];

    // Verify candidates with the full substring check.
    const results: number[] = [];
    const limit = Math.min(bestList.length, MAX_CANDIDATE_VERIFY);
    for (let i = 0; i < limit; i++) {
      const idx = bestList[i];
      if (this.entries[idx].text.includes(input)) {
        results.push(idx);
      }
    }
    return results;
  }

  /** Brute-force scan for queries shorter than 3 characters. */
  private _linearScan(input: string): number[] {
    const results: number[] = [];
    for (let i = 0; i < this.entries.length; i++) {
      if (this.entries[i].text.includes(input)) {
        results.push(i);
      }
    }
    return results;
  }

  // ── Ranking ─────────────────────────────────────────────────────────────

  /**
   * Score candidates and return the best one.
   *
   * Scoring heuristics (higher is better):
   *   1. Match position: closer to start = higher score.
   *   2. Asset entries get a fixed boost.
   *   3. More recent entries score slightly higher.
   *   4. Shorter entries get a small edge (less noise for the user).
   */
  private _rank(input: string, candidateIndices: number[]): string | null {
    const now = Date.now();
    let bestScore = -Infinity;
    let bestIdx = -1;

    for (const idx of candidateIndices) {
      const entry = this.entries[idx];
      const pos = entry.text.indexOf(input);
      if (pos === -1) continue;

      let score = 0;

      // Position bonus: exact start = 200, each offset costs 1 point.
      score += Math.max(0, 200 - pos);

      // Asset boost.
      if (entry.isAsset) score += 500;

      // Recency: normalized to ~0…10 range within a reasonable window.
      const ageMs = Math.max(0, now - entry.timestamp);
      const recency = Math.max(0, 10 - ageMs / (1000 * 60 * 60 * 24 * 30)); // 30-day decay
      score += recency;

      // Slight length preference for shorter completions.
      score += Math.max(0, (200 - entry.text.length) * 0.2);

      if (score > bestScore) {
        bestScore = score;
        bestIdx = idx;
      }
    }

    return bestIdx >= 0 ? this.entries[bestIdx].text : null;
  }
}