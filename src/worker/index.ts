/**
 * Parser worker entry point.
 *
 * Thin transport adapter on top of the transport-neutral
 * ParserSession (in src/core/). This file owns:
 *   - the message contract (WorkerRequest / WorkerResponse)
 *   - dispatching incoming requests to the session
 *   - serializing errors back to the main thread
 *
 * Anything PDF-specific lives in ParserSession.
 */

/// <reference lib="webworker" />

import type { WorkerRequest, WorkerResponse } from "../shared/protocol";
import { serializeError } from "../shared/protocol";
import { ParserSession } from "../core/parser-session";

const ctx = self as unknown as DedicatedWorkerGlobalScope;
const session = new ParserSession();

function send(res: WorkerResponse, transfer?: Transferable[]): void {
  if (transfer && transfer.length > 0) {
    ctx.postMessage(res, transfer);
  } else {
    ctx.postMessage(res);
  }
}

async function dispatch(req: WorkerRequest): Promise<void> {
  try {
    switch (req.type) {
      case "ping": {
        send({ id: req.id, ok: true, type: "pong", result: req.payload ?? null });
        return;
      }
      case "load": {
        const result = await session.load(req.bytes);
        send({ id: req.id, ok: true, type: "loaded", result });
        return;
      }
      case "getObjectDetail": {
        const result = session.getObjectDetail(req.objectId);
        send({ id: req.id, ok: true, type: "objectDetail", result });
        return;
      }
      case "getStream": {
        const result = await session.getStream(req.objectId, req.mode);
        send({ id: req.id, ok: true, type: "stream", result }, [result.bytes]);
        return;
      }
      case "getPageOperations": {
        const result = await session.getPageOperations(req.pageNumber);
        send({ id: req.id, ok: true, type: "pageOperations", result });
        return;
      }
      case "cancel": {
        // Cancellation is handled inside long-running handlers; this is a no-op
        // when no work is in flight for the given id.
        return;
      }
    }
  } catch (err) {
    send({ id: req.id, ok: false, error: serializeError(err) });
  }
}

ctx.addEventListener("message", (event: MessageEvent<WorkerRequest>) => {
  void dispatch(event.data);
});
