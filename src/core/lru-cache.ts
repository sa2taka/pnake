/**
 * Tiny LRU cache. Used to memoize decoded stream payloads inside the
 * parser worker so repeated UI requests (raw → decoded → raw …) do
 * not re-run FlateDecode for the same object every time.
 *
 * No fancy weak-ref or size-based eviction — just a Map iteration
 * order trick (Map preserves insertion order, so we delete-then-set
 * to refresh, and shrink from the head when over capacity).
 */

export class LruCache<K, V> {
  private readonly map = new Map<K, V>();

  constructor(private readonly capacity: number) {
    if (capacity <= 0) throw new RangeError("LruCache capacity must be > 0");
  }

  get(key: K): V | undefined {
    const value = this.map.get(key);
    if (value === undefined) return undefined;
    // Refresh recency.
    this.map.delete(key);
    this.map.set(key, value);
    return value;
  }

  set(key: K, value: V): void {
    if (this.map.has(key)) this.map.delete(key);
    this.map.set(key, value);
    while (this.map.size > this.capacity) {
      const oldest = this.map.keys().next();
      if (oldest.done || oldest.value === undefined) break;
      this.map.delete(oldest.value);
    }
  }

  clear(): void {
    this.map.clear();
  }

  get size(): number {
    return this.map.size;
  }

  has(key: K): boolean {
    return this.map.has(key);
  }
}
