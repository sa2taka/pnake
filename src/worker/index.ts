/**
 * Parser worker entry point.
 *
 * Thin transport adapter on top of the transport-neutral
 * ParserSession (in src/core/). This file owns:
 *   - dispatching incoming WorkerRequests to the session
 *   - serializing errors back to the main thread
 *
 * The wire shape itself is declared in shared/protocol.ts so both sides
 * derive request and response envelopes from a single RpcMethods map.
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
  if (req.type === "cancel") {
    // Cancellation is handled inside long-running handlers; this is a no-op
    // when no work is in flight for the given id.
    return;
  }
  try {
    switch (req.type) {
      case "ping": {
        send({ id: req.id, ok: true, type: "ping", result: req.payload ?? null });
        return;
      }
      case "load": {
        const result = await session.load(req.bytes);
        send({ id: req.id, ok: true, type: "load", result });
        return;
      }
      case "getObjectDetail": {
        const result = session.getObjectDetail(req.objectId);
        send({ id: req.id, ok: true, type: "getObjectDetail", result });
        return;
      }
      case "getStream": {
        const result = await session.getStream(req.objectId, req.mode);
        send({ id: req.id, ok: true, type: "getStream", result }, [result.bytes]);
        return;
      }
      case "getPageOperations": {
        const result = await session.getPageOperations(req.pageNumber);
        send({ id: req.id, ok: true, type: "getPageOperations", result });
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
