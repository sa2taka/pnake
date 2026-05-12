import { describe, expect, it } from "vitest";
import { LruCache } from "../../../src/worker/lru-cache";

describe("LruCache", () => {
  it("returns undefined for missing keys", () => {
    const c = new LruCache<string, number>(3);
    expect(c.get("x")).toBeUndefined();
  });

  it("preserves recency on get", () => {
    const c = new LruCache<string, number>(3);
    c.set("a", 1);
    c.set("b", 2);
    c.set("c", 3);
    // Touch "a" to refresh recency.
    c.get("a");
    c.set("d", 4); // should evict "b", the oldest after the touch.
    expect(c.has("a")).toBe(true);
    expect(c.has("b")).toBe(false);
    expect(c.has("c")).toBe(true);
    expect(c.has("d")).toBe(true);
  });

  it("evicts the least-recently-used entry on overflow", () => {
    const c = new LruCache<string, number>(2);
    c.set("a", 1);
    c.set("b", 2);
    c.set("c", 3);
    expect(c.has("a")).toBe(false);
    expect(c.has("b")).toBe(true);
    expect(c.has("c")).toBe(true);
  });

  it("clear empties the cache", () => {
    const c = new LruCache<string, number>(3);
    c.set("a", 1);
    c.clear();
    expect(c.size).toBe(0);
  });

  it("rejects zero or negative capacity", () => {
    expect(() => new LruCache<string, number>(0)).toThrow(RangeError);
    expect(() => new LruCache<string, number>(-1)).toThrow(RangeError);
  });
});
