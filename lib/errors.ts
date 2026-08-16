export type ErrorType =
  | "bad_request"
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "rate_limit"
  | "offline";

export type Surface = "chat" | "api" | "history" | "share";

export type ErrorCode = `${ErrorType}:${Surface}`;

export type ErrorVisibility = "response" | "log" | "none";

/** The known error types, for runtime validation of error bodies. */
const ERROR_TYPES: readonly ErrorType[] = [
  "bad_request",
  "unauthorized",
  "forbidden",
  "not_found",
  "rate_limit",
  "offline",
];

/** The known surfaces, for runtime validation of error bodies. */
const SURFACES: readonly Surface[] = ["chat", "api", "history", "share"];

/** True when `value` is a well-formed ErrorCode (`type:surface`). */
export function isErrorCode(value: unknown): value is ErrorCode {
  if (typeof value !== "string") {
    return false;
  }
  const [type, surface] = value.split(":");
  return (
    (ERROR_TYPES as readonly string[]).includes(type) &&
    (SURFACES as readonly string[]).includes(surface)
  );
}

/**
 * ErrorCode derived from an HTTP status, for responses whose body carries
 * no `code`. The FastAPI backend answers with `{"detail": ...}`, not the
 * frontend's `{code, cause}` shape — without this fallback every failed
 * request would construct ChatbotError from `undefined` and crash on
 * `.split`.
 */
export function errorCodeFromStatus(
  status: number,
  surface: Surface,
): ErrorCode {
  switch (status) {
    case 401:
      return `unauthorized:${surface}`;
    case 403:
      return `forbidden:${surface}`;
    case 404:
      return `not_found:${surface}`;
    case 429:
      return `rate_limit:${surface}`;
    default:
      return `bad_request:${surface}`;
  }
}

export const visibilityBySurface: Record<Surface, ErrorVisibility> = {
  api: "response",
  chat: "response",
  history: "response",
  share: "response",
};

export class ChatbotError extends Error {
  type: ErrorType;
  surface: Surface;
  statusCode: number;

  constructor(errorCode: ErrorCode, cause?: string | ErrorOptions) {
    // Belt and braces: runtime error bodies can carry no `code` at all (the
    // backend's `{"detail": ...}` HTTPException shape). Never crash the
    // caller's error handling on `undefined.split(":")`.
    const normalized: ErrorCode = isErrorCode(errorCode)
      ? errorCode
      : "bad_request:api";
    const message = getMessageByErrorCode(normalized);
    const options = typeof cause === "string" ? undefined : cause;

    super(message, options);

    const [type, surface] = normalized.split(":");

    this.type = type as ErrorType;
    if (typeof cause === "string") {
      this.cause = cause;
    }
    this.surface = surface as Surface;
    this.statusCode = getStatusCodeByType(this.type);
  }

  toResponse() {
    const code: ErrorCode = `${this.type}:${this.surface}`;
    const visibility = visibilityBySurface[this.surface];

    const { message, cause, statusCode } = this;

    if (visibility === "log") {
      console.error({
        cause,
        code,
        message,
      });

      return Response.json(
        { code: "", message: "Something went wrong. Please try again later." },
        { status: statusCode },
      );
    }

    return Response.json({ cause, code, message }, { status: statusCode });
  }
}

export function getMessageByErrorCode(errorCode: ErrorCode): string {
  switch (errorCode) {
    case "bad_request:api":
      return "The request couldn't be processed. Please check your input and try again.";
    case "rate_limit:chat":
      return "You've reached the message limit. Try again later.";
    case "offline:chat":
      return "We're having trouble sending your message. Please check your internet connection and try again.";
    case "unauthorized:chat":
      return "Your session expired — please sign in again.";
    case "forbidden:chat":
      return "You don't have permission to do that.";
    case "not_found:chat":
      return "That conversation no longer exists.";
    case "bad_request:share":
      return "Couldn't share this chat. Please try again.";
    case "unauthorized:share":
      return "Please sign in to share a chat.";
    case "not_found:share":
      return "The shared chat could not be found.";
    case "offline:share":
      return "We're having trouble sharing your chat. Please check your internet connection and try again.";
    default:
      return "Something went wrong. Please try again later.";
  }
}

function getStatusCodeByType(type: ErrorType) {
  switch (type) {
    case "bad_request":
      return 400;
    case "unauthorized":
      return 401;
    case "forbidden":
      return 403;
    case "not_found":
      return 404;
    case "rate_limit":
      return 429;
    case "offline":
      return 503;
    default:
      return 500;
  }
}
