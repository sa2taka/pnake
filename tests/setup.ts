import "@testing-library/jest-dom/vitest";

// jsdom doesn't ship a ResizeObserver implementation. Stub it so
// components that rely on it (e.g. the virtualization hook) keep
// rendering in unit tests.
class ResizeObserverStub {
  observe(): void {
    /* no-op */
  }
  unobserve(): void {
    /* no-op */
  }
  disconnect(): void {
    /* no-op */
  }
}

if (typeof globalThis.ResizeObserver === "undefined") {
  (globalThis as unknown as { ResizeObserver: typeof ResizeObserverStub }).ResizeObserver =
    ResizeObserverStub;
}
