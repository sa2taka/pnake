/**
 * Parser worker entry point.
 *
 * Receives WorkerRequest messages and dispatches them to handlers.
 * Handlers are added in later commits — this file establishes the
 * routing skeleton and the request/response contract.
 */

/// <reference lib="webworker" />

import type { WorkerRequest, WorkerResponse } from "../shared/protocol";
import { serializeError } from "../shared/protocol";
import { ParserState } from "./handlers";

const ctx = self as unknown as DedicatedWorkerGlobalScope;
const state = new ParserState();

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
        const result = await state.load(req.bytes);
        send({ id: req.id, ok: true, type: "loaded", result });
        return;
      }
      case "getObjectDetail": {
        const result = state.getObjectDetail(req.objectId);
        send({ id: req.id, ok: true, type: "objectDetail", result });
        return;
      }
      case "getStream": {
        const result = await state.getStream(req.objectId, req.mode);
        send({ id: req.id, ok: true, type: "stream", result }, [result.bytes]);
        return;
      }
      case "getPageOperations": {
        const result = await state.getPageOperations(req.pageNumber);
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
