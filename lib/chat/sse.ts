// Fetch-based Server-Sent Events reader.
//
// EventSource cannot send Authorization headers, so the notification stream
// (and thread attach stream) are read with fetch + ReadableStream. Handles
// `:` comment lines (the backend sends a `: ping` keepalive every 15s),
// multi-line `data:` payloads, and JSON parsing (non-JSON data passes
// through as the raw string).

export type SSEHandler = (event: string, data: unknown) => void;

/**
 * Read an SSE stream from `url`, invoking `onEvent` for every parsed event.
 *
 * Resolves when the stream ends (server close) or the caller aborts
 * `signal` (clean disconnect — abort is not an error). Rejects on network
 * errors, non-2xx responses, or a broken body.
 */
export async function readSSE(
  url: string,
  onEvent: SSEHandler,
  signal: AbortSignal,
  init?: RequestInit,
): Promise<void> {
  try {
    const res = await fetch(url, { ...init, signal });
    if (!res.ok) {
      throw new Error(`SSE request failed (${res.status})`);
    }
    const body = res.body;
    if (!body) {
      throw new Error("SSE response has no body");
    }
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }
        buffer += decoder.decode(value, { stream: true });
        const blocks = buffer.split("\n\n");
        buffer = blocks.pop() ?? "";
        for (const block of blocks) {
          const lines = block.split("\n");
          // `: comment` keepalive blocks carry no event.
          if (lines.every((line) => line.startsWith(":"))) {
            continue;
          }
          let event = "message";
          const dataLines: string[] = [];
          for (const line of lines) {
            if (line.startsWith(":")) {
              continue;
            }
            if (line.startsWith("event:")) {
              event = line.slice(6).trim();
            } else if (line.startsWith("data:")) {
              dataLines.push(line.slice(5).trimStart());
            }
          }
          if (dataLines.length === 0) {
            continue;
          }
          const raw = dataLines.join("\n");
          let data: unknown = raw;
          try {
            data = JSON.parse(raw) as unknown;
          } catch {
            // non-JSON payload — hand the raw string to the handler
          }
          onEvent(event, data);
        }
      }
    } finally {
      reader.releaseLock();
    }
  } catch (error) {
    // Our own disconnect: not an error.
    if (signal.aborted) {
      return;
    }
    throw error;
  }
}
