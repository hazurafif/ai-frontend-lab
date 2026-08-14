import {
  type ChatTransport,
  DefaultChatTransport,
  type UIMessage,
  type UIMessageChunk,
} from "ai";

/** Resolve a value, a promise of it, or a thunk returning either. */
async function resolveValue<T>(
  value: T | PromiseLike<T> | (() => T | PromiseLike<T>) | undefined,
): Promise<T | undefined> {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value === "function") {
    return await (value as () => T | PromiseLike<T>)();
  }
  return await value;
}

/** Normalize HeadersInit-ish values to a plain record (lowercased keys). */
function normalizeHeaders(
  headers: HeadersInit | Record<string, string | undefined> | undefined,
): Record<string, string> {
  const out: Record<string, string> = {};
  if (!headers) {
    return out;
  }
  new Headers(headers as HeadersInit).forEach((value, key) => {
    out[key] = value;
  });
  return out;
}

/**
 * DefaultChatTransport that switches to multipart/form-data when a message
 * carries file attachments, matching the backend's /api/chat multipart
 * contract: a JSON-encoded `messages` field + `files` uploads (the backend
 * saves them, appends their paths to the user text, and the agent's
 * filesystem/execute tools manipulate them).
 *
 * Everything else is identical to the JSON path: the same request
 * preparation (auth headers, body merge, edit truncation) and the same
 * data-stream parsing. Sending without attachments stays pure JSON.
 */
export class UploadChatTransport<
  UI_MESSAGE extends UIMessage,
> extends DefaultChatTransport<UI_MESSAGE> {
  override async sendMessages(
    options: Parameters<ChatTransport<UI_MESSAGE>["sendMessages"]>[0],
  ): Promise<ReadableStream<UIMessageChunk>> {
    const hasAttachments = options.messages.some((message) =>
      message.parts.some(
        (part) =>
          part.type === "file" && "file" in part && part.file instanceof File,
      ),
    );
    if (!hasAttachments) {
      return super.sendMessages(options);
    }

    const { abortSignal, ...rest } = options;
    const resolvedBody = await resolveValue(this.body);
    const resolvedHeaders = await resolveValue(this.headers);
    const resolvedCredentials = await resolveValue(this.credentials);

    const baseHeaders = {
      ...normalizeHeaders(resolvedHeaders),
      ...normalizeHeaders(rest.headers),
    };

    const preparedRequest = await this.prepareSendMessagesRequest?.({
      api: this.api,
      id: rest.chatId,
      messages: rest.messages,
      body: { ...resolvedBody, ...rest.body },
      headers: baseHeaders,
      credentials: resolvedCredentials,
      requestMetadata: rest.metadata,
      trigger: rest.trigger,
      messageId: rest.messageId,
    });

    const api = preparedRequest?.api ?? this.api;
    const headers = normalizeHeaders(
      preparedRequest?.headers !== undefined
        ? preparedRequest.headers
        : baseHeaders,
    );
    const body =
      preparedRequest?.body !== undefined
        ? preparedRequest.body
        : {
            ...resolvedBody,
            ...rest.body,
            id: rest.chatId,
            messages: rest.messages,
          };
    const credentials = preparedRequest?.credentials ?? resolvedCredentials;

    const form = new FormData();
    const record = body as Record<string, unknown>;
    form.set("messages", JSON.stringify(record.messages ?? rest.messages));
    if (record.id !== undefined && record.id !== null) {
      form.set("id", String(record.id));
    }
    if (record.enableSearch !== undefined && record.enableSearch !== null) {
      form.set("enable_search", String(record.enableSearch));
    }
    if (record.selectedChatModel) {
      form.set("selectedChatModel", String(record.selectedChatModel));
    }
    if (record.thinking) {
      form.set("thinking", String(record.thinking));
    }
    for (const message of rest.messages) {
      for (const part of message.parts) {
        if (
          part.type === "file" &&
          "file" in part &&
          part.file instanceof File
        ) {
          form.append("files", part.file, part.file.name);
        }
      }
    }

    // Avoid caching globalThis.fetch in case it is patched by other libraries.
    const fetchImpl = this.fetch ?? globalThis.fetch;
    const response = await fetchImpl(api, {
      method: "POST",
      // No Content-Type: the browser sets the multipart boundary itself.
      headers,
      body: form,
      credentials,
      signal: abortSignal,
    });

    if (!response.ok) {
      throw new Error(
        (await response.text()) || "Failed to fetch the chat response.",
      );
    }

    if (!response.body) {
      throw new Error("The response body is empty.");
    }

    return this.processResponseStream(response.body);
  }
}
