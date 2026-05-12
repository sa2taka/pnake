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

const ctx = self as unknown as DedicatedWorkerGlobalScope;

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
      case "load":
      case "getObjectDetail":
      case "getStream":
      case "getPageOperations":
      case "cancel": {
        send({
          id: req.id,
          ok: false,
          error: {
            name: "NotImplemented",
            message: `Handler for ${req.type} is not yet implemented`,
          },
        });
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
