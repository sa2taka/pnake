import { describe, expect, it } from "vitest";
import { WorkerClient } from "../../src/ui/workerClient";
import type { WorkerRequest, WorkerResponse } from "../../src/shared/protocol";

/**
 * Fake Worker implementation matching the slice of the Worker interface
 * WorkerClient actually uses. Lets us exercise the protocol without
 * spinning up a real worker thread in jsdom.
 */
class FakeWorker extends EventTarget {
  posted: WorkerRequest[] = [];
  responder: (req: WorkerRequest) => WorkerResponse | undefined = () => undefined;

  postMessage(message: WorkerRequest): void {
    this.posted.push(message);
    queueMicrotask(() => {
      const response = this.responder(message);
      if (response) {
        this.dispatchEvent(new MessageEvent("message", { data: response }));
      }
    });
  }

  terminate(): void {
    /* no-op */
  }
}

function makeClient(): { client: WorkerClient; fake: FakeWorker } {
  const fake = new FakeWorker();
  const client = new WorkerClient(fake as unknown as Worker);
  return { client, fake };
}

describe("WorkerClient", () => {
  it("round-trips a ping payload", async () => {
    const { client, fake } = makeClient();
    fake.responder = (req) =>
      req.type === "ping"
        ? { id: req.id, ok: true, type: "pong", result: req.payload }
        : undefined;

    const result = await client.ping("hello");
    expect(result).toBe("hello");
    expect(fake.posted[0]).toMatchObject({ type: "ping", payload: "hello" });
  });

  it("propagates worker errors as rejected promises", async () => {
    const { client, fake } = makeClient();
    fake.responder = (req) => ({
      id: req.id,
      ok: false,
      error: { name: "Oops", message: "boom" },
    });
    await expect(client.ping()).rejects.toMatchObject({ name: "Oops", message: "boom" });
  });

  it("correlates concurrent requests by id", async () => {
    const { client, fake } = makeClient();
    fake.responder = (req) =>
      req.type === "ping"
        ? { id: req.id, ok: true, type: "pong", result: req.payload }
        : undefined;

    const [a, b, c] = await Promise.all([client.ping("a"), client.ping("b"), client.ping("c")]);
    expect([a, b, c]).toEqual(["a", "b", "c"]);
  });

  it("forwards progress events to the caller", async () => {
    const fake = new FakeWorker();
    const client = new WorkerClient(fake as unknown as Worker);
    const progress: number[] = [];

    // Custom responder that dispatches progress synchronously, then schedules
    // the final pong to arrive after the progress event.
    fake.responder = (req) => {
      fake.dispatchEvent(
        new MessageEvent("message", {
          data: { id: req.id, progress: 0.5, phase: "loading" } satisfies WorkerResponse,
        }),
      );
      return { id: req.id, ok: true, type: "pong", result: null };
    };

    await client.ping(null, { onProgress: (p) => progress.push(p) });
    expect(progress).toEqual([0.5]);
  });

  it("supports cancellation via AbortSignal", async () => {
    const { client, fake } = makeClient();
    fake.responder = () => undefined; // never responds
    const ac = new AbortController();
    const promise = client.ping(null, { signal: ac.signal });
    ac.abort();
    await expect(promise).rejects.toThrow(/Aborted/);
  });

  it("rejects subsequent calls after terminate() with a fast failure", async () => {
    const { client } = makeClient();
    client.terminate();
    expect(client.isClosed).toBe(true);
    await expect(client.ping()).rejects.toThrow(/terminated/);
  });

  it("transitions to closed on a fatal worker ErrorEvent and rejects future calls", async () => {
    const { client, fake } = makeClient();
    fake.dispatchEvent(new ErrorEvent("error", { message: "boom" }));
    expect(client.isClosed).toBe(true);
    await expect(client.ping()).rejects.toThrow(/boom/);
  });
});
