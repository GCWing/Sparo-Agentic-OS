/**
 * Fast prefix-matching Trie optimized for CJK and ASCII input history autocomplete.
 *
 * Each node stores a Map from code-point string (length-1) to child node.
 * We store the matched full-text only at leaf-like positions where the match
 * is known to be longer than the prefix (open-branch → deepest-first-match).
 *
 * No dependency on locale-aware char segmentation — we iterate by `[...text]`
 * which gives one element per Unicode code point, correct for BMP and astral
 * characters alike.
 */

export interface TrieMatch {
  /** The full text of the matched entry */
  value: string;
}

interface PromptTrieNode {
  children: Map<string, PromptTrieNode>;
  /** First (i.e. most-recent) full match reachable from this node (depth-first). */
  bestMatch: string | null;
}

export class PromptTrie {
  private static readonly MAX_DEPTH = 30;

  private root: PromptTrieNode;

  constructor() {
    this.root = PromptTrie._makeNode();
  }

  // ── Public API ────────────────────────────────────────────────────────────

  /** Build (or rebuild) the trie from a collection of entries.
   *  Earlier entries in the iterable have higher priority. */
  static fromEntries(entries: Iterable<string>): PromptTrie {
    const trie = new PromptTrie();
    trie.insertAll(entries);
    return trie;
  }

  /** Insert many entries; earlier entries shadow later ones at matching depth. */
  insertAll(entries: Iterable<string>): void {
    for (const entry of entries) {
      this.insert(entry);
    }
  }

  /** Insert a single entry.
   *  Only the first `MAX_DEPTH` code points are inserted as trie nodes;
   *  the full text is always stored in `bestMatch` references. */
  insert(text: string): void {
    const trimmed = text.trim();
    if (trimmed.length === 0) return;

    const chars = [...trimmed];
    const depth = Math.min(chars.length, PromptTrie.MAX_DEPTH);
    let node = this.root;

    for (let i = 0; i < depth; i++) {
      const ch = chars[i];
      let child = node.children.get(ch);
      if (!child) {
        child = PromptTrie._makeNode();
        node.children.set(ch, child);
      }
      node = child;
      // Mark this node with the current text (earliest-wins = higher priority).
      if (node.bestMatch === null) {
        node.bestMatch = trimmed;
      }
    }
  }

  /**
   * Return the first full match where `prefix` is a strict prefix.
   * Returns `null` when there is no longer match than `prefix` itself.
   */
  autocomplete(prefix: string): string | null {
    const trimmed = prefix.trim();
    if (trimmed.length === 0) return null;

    const node = this._walk(trimmed);
    if (!node) return null;

    // Any bestMatch we stopped at is guaranteed to start with `prefix`.
    const candidate = node.bestMatch;
    if (candidate == null) return null;
    if (candidate.length <= trimmed.length) return null;
    // Sanity check — should always hold.
    if (!candidate.startsWith(trimmed)) return null;
    return candidate;
  }

  /** Number of nodes in the trie (for debugging / size monitoring). */
  nodeCount(): number {
    let count = 0;
    const stack = [this.root];
    while (stack.length > 0) {
      const n = stack.pop()!;
      count++;
      for (const child of n.children.values()) {
        stack.push(child);
      }
    }
    return count;
  }

  // ── Internal helpers ──────────────────────────────────────────────────────

  private static _makeNode(): PromptTrieNode {
    return { children: new Map(), bestMatch: null };
  }

  /** Walk the trie following each char of `text`. Returns the deepest node
   *  reached, or `null` if the string path does not exist. */
  private _walk(text: string): PromptTrieNode | null {
    const chars = [...text];
    let node = this.root;
    for (const ch of chars) {
      const child = node.children.get(ch);
      if (!child) return null;
      node = child;
    }
    return node;
  }
}