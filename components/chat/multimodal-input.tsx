"use client";

import type { UseChatHelpers } from "@ai-sdk/react";
import {
  ArrowUpIcon,
  BrainIcon,
  CheckIcon,
  ChevronDownIcon,
  MicIcon,
  PlusIcon,
  PuzzleIcon,
  SquareIcon,
  XIcon,
} from "lucide-react";
import type { FormEvent, KeyboardEvent } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getContextWindow } from "tokenlens";
import {
  Attachment,
  AttachmentPreview,
  AttachmentRemove,
  Attachments,
} from "@/components/ai-elements/attachments";
import {
  Context,
  ContextCacheUsage,
  ContextContent,
  ContextContentBody,
  ContextContentFooter,
  ContextContentHeader,
  ContextIcon,
  ContextInputUsage,
  ContextOutputUsage,
  ContextReasoningUsage,
  ContextTrigger,
} from "@/components/ai-elements/context";
import {
  ModelSelector,
  ModelSelectorContent,
  ModelSelectorEmpty,
  ModelSelectorGroup,
  ModelSelectorInput,
  ModelSelectorItem,
  ModelSelectorList,
  ModelSelectorTrigger,
} from "@/components/ai-elements/model-selector";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Kbd } from "@/components/ui/kbd";
import { Textarea } from "@/components/ui/textarea";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useAvailableModels } from "@/hooks/use-available-models";
import { useThreads } from "@/lib/chat/chat-store";
import { THREAD_ACTIVITY_EVENT } from "@/lib/constants";
import { chatModelName, chatModels } from "@/lib/models";
import {
  fetchBackendHealth,
  THINKING_EFFORTS,
  type ThinkingEffort,
} from "@/lib/settings";
import { fetchThreadUsage, type ThreadUsage } from "@/lib/threads";
import type { ChatMessage } from "@/lib/types";
import { SparklesIcon } from "./icons";

const THINKING_EFFORT_LABELS: Record<ThinkingEffort, string> = {
  high: "High",
  low: "Low",
  max: "Max",
  medium: "Medium",
  minimal: "Minimal",
  none: "None",
  xhigh: "Extra high",
};

// Minimal shape of the Web Speech API recognition (untyped in TS DOM lib).
type SpeechRecognitionLike = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onend: (() => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onresult:
    | ((event: {
        resultIndex: number;
        results: ArrayLike<{
          isFinal: boolean;
          0: { transcript: string };
        }>;
      }) => void)
    | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
};

/** Browser speech recognition constructor (Chrome/Edge/Safari); null elsewhere. */
function speechRecognitionCtor(): (new () => SpeechRecognitionLike) | null {
  const w = window as unknown as {
    SpeechRecognition?: new () => SpeechRecognitionLike;
    webkitSpeechRecognition?: new () => SpeechRecognitionLike;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/**
 * Resolve the model to an id tokenlens knows (its catalog uses bare model
 * ids): try the raw id, then the part after the `provider:` prefix, then
 * fall back to `deepseek-chat` — the opencode proxy serves the DeepSeek
 * chat line under names like `deepseek-v4-flash` that neither the backend's
 * curated table nor the tokenlens catalog list (deepseek-chat is the same
 * line: 128k window + pricing). Null when truly unknown.
 */
function tokenlensModelId(model: string | null | undefined): string | null {
  if (!model) {
    return null;
  }
  const candidates = [model, model.split(":")[1] ?? model];
  for (const id of candidates) {
    if (getContextWindow(id)?.combinedMax) {
      return id;
    }
  }
  if (model.includes("deepseek")) {
    return "deepseek-chat";
  }
  return null;
}

type MultimodalInputProps = {
  chatId: string;
  editingMessage: ChatMessage | null;
  input: string;
  isLoading: boolean;
  messages: ChatMessage[];
  onCancelEdit: () => void;
  onModelChange: (modelId: string) => void;
  onThinkingEffortChange: (effort: ThinkingEffort) => void;
  selectedModelId: string;
  sendMessage: UseChatHelpers<ChatMessage>["sendMessage"];
  setInput: (value: string) => void;
  setMessages: UseChatHelpers<ChatMessage>["setMessages"];
  status: UseChatHelpers<ChatMessage>["status"];
  stop: UseChatHelpers<ChatMessage>["stop"];
  thinkingEffort: ThinkingEffort;
};
export function MultimodalInput({
  chatId,
  editingMessage,
  input,
  isLoading,
  onCancelEdit,
  onModelChange,
  onThinkingEffortChange,
  selectedModelId,
  sendMessage,
  setInput,
  status,
  stop,
  thinkingEffort,
}: MultimodalInputProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [modelSelectorOpen, setModelSelectorOpen] = useState(false);
  const [inputFocused, setInputFocused] = useState(false);
  // Picked files with their object URL created ONCE at pick time (never in
  // render — render-time createObjectURL leaks a new blob URL per re-render
  // and makes previews unstable under StrictMode double-rendering). URLs are
  // revoked on remove, chat switch, and unmount.
  const [attachments, setAttachments] = useState<{ file: File; url: string }[]>(
    [],
  );
  const attachmentsRef = useRef(attachments);
  useEffect(() => {
    attachmentsRef.current = attachments;
  }, [attachments]);

  // TEMP DEBUG
  // Run status of this thread from the durable-chat store (background runs
  // started elsewhere — another tab, "new chat" while answering).
  const { statuses } = useThreads();
  const backgroundRun = !isLoading && statuses[chatId] === "running";
  // Whether the backend can execute shell commands (GET /health
  // execute.enabled, EXECUTE_ENABLED) — required for the agent to reach
  // uploaded files. null = unknown (still loading / offline → allow).
  const [executeEnabled, setExecuteEnabled] = useState<boolean | null>(null);
  // MCP tool servers connected on the backend (GET /health mcp_servers).
  const [mcpServers, setMcpServers] = useState<string[]>([]);
  // Context + usage report (GET /threads/{id}/usage). Refetches when the
  // thread changes, a run settles, or any run lifecycle event lands
  // (THREAD_ACTIVITY_EVENT — cheap endpoint, keeps the ring and the
  // background-run indicator current). Hidden for new chats / guests (no
  // server report yet — 404/401 → null).
  const [usage, setUsage] = useState<ThreadUsage | null>(null);

  const refreshUsage = useCallback(() => {
    if (status === "submitted" || status === "streaming") {
      return;
    }
    fetchThreadUsage(chatId)
      .then((next) => {
        setUsage((current) =>
          // Drop stale reports (thread switched while fetching).
          current === null ||
          next === null ||
          current.thread_id === next.thread_id
            ? next
            : current,
        );
      })
      .catch(() => {
        // offline / no report — leave the readout hidden
      });
  }, [chatId, status]);

  useEffect(() => {
    setUsage(null);
    refreshUsage();
    const onActivity = () => {
      refreshUsage();
    };
    window.addEventListener(THREAD_ACTIVITY_EVENT, onActivity);
    return () => {
      window.removeEventListener(THREAD_ACTIVITY_EVENT, onActivity);
    };
  }, [refreshUsage]);

  // The model context window: the backend's curated table first, tokenlens
  // as fallback (see tokenlensModelId). Null → the ring stays hidden and
  // the plain token-count pill carries the info.
  const contextWindow = useMemo(() => {
    if (usage?.context?.context_window) {
      return usage.context.context_window;
    }
    const resolved = tokenlensModelId(usage?.model);
    return resolved ? (getContextWindow(resolved)?.combinedMax ?? null) : null;
  }, [usage?.context?.context_window, usage?.model]);

  const costModelId = useMemo(
    () => tokenlensModelId(usage?.model) ?? usage?.model ?? undefined,
    [usage?.model],
  );

  // Backend cumulative usage → AI SDK v7 LanguageModelUsage (the ai-elements
  // Context card reads inputTokens/outputTokens and the nested details).
  const aiUsage = useMemo(() => {
    if (!usage?.usage) {
      return undefined;
    }
    return {
      inputTokenDetails: {
        cacheReadTokens: undefined,
        cacheWriteTokens: undefined,
        noCacheTokens: undefined,
      },
      inputTokens: usage.usage.input_tokens,
      outputTokenDetails: {
        reasoningTokens: undefined,
        textTokens: undefined,
      },
      outputTokens: usage.usage.output_tokens,
      totalTokens: usage.usage.total_tokens,
    };
  }, [usage?.usage]);

  // Whether a run of this thread is in flight that we are NOT streaming
  // ourselves (started in the background): the backend 409s a second run on
  // a thread with an active one, so sending is disabled while it lasts.
  const runActive = backgroundRun || usage?.active_run === true;

  // Mount-gated platform check (hydration rule): server + first client
  // render show the macOS glyph, then flip to the Ctrl label on other OSes.
  const [isMac, setIsMac] = useState(true);

  // Backend execute capability for the upload button (EXECUTE_ENABLED) +
  // connected MCP servers for the tools indicator.
  useEffect(() => {
    let cancelled = false;
    fetchBackendHealth()
      .then((health) => {
        if (!cancelled) {
          setExecuteEnabled(health?.execute?.enabled ?? null);
          setMcpServers(health?.mcp_servers ?? []);
        }
      })
      .catch(() => {
        // offline — leave unknown (uploads stay allowed)
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Drop picked files when switching chats so attachments never leak.
  useEffect(() => {
    setAttachments((current) => {
      for (const attachment of current) {
        URL.revokeObjectURL(attachment.url);
      }
      return [];
    });
  }, [chatId]);

  // Revoke any URLs still alive when the composer unmounts.
  useEffect(() => {
    return () => {
      for (const attachment of attachmentsRef.current) {
        URL.revokeObjectURL(attachment.url);
      }
    };
  }, []);

  // Global ⌘K / Ctrl+K — focus the message input from anywhere in the app.
  useEffect(() => {
    setIsMac(/mac/i.test(navigator.platform || navigator.userAgent));
  }, []);

  // Dictation via the Web Speech API (browser-native, no backend). The mic
  // button toggles it; transcripts append to the current input, keeping
  // whatever was typed before the mic went on.
  const [speechSupported, setSpeechSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const baseInputRef = useRef("");

  useEffect(() => {
    const Ctor = speechRecognitionCtor();
    if (!Ctor) {
      return;
    }
    setSpeechSupported(true);
    const recognition = new Ctor();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "en-US";
    // Live updates: the latest (interim or final) result replaces the
    // dictation tail of the input.
    recognition.onresult = (event) => {
      const latest = event.results[event.resultIndex];
      if (!latest) {
        return;
      }
      setInput(`${baseInputRef.current}${latest[0].transcript}`);
    };
    recognition.onend = () => setListening(false);
    recognition.onerror = () => setListening(false);
    recognitionRef.current = recognition;
    return () => {
      recognition.abort();
      recognitionRef.current = null;
    };
  }, [setInput]);

  const toggleDictation = () => {
    const recognition = recognitionRef.current;
    if (!recognition) {
      return;
    }
    if (listening) {
      recognition.stop();
      setListening(false);
      return;
    }
    baseInputRef.current = input;
    recognition.start();
    setListening(true);
  };

  // ⌘D / Ctrl+D — toggle dictation from anywhere (the mic button shows it).
  useEffect(() => {
    const handleDictationKeyDown = (event: globalThis.KeyboardEvent) => {
      if (
        (event.metaKey || event.ctrlKey) &&
        event.key.toLowerCase() === "d" &&
        !event.altKey
      ) {
        event.preventDefault();
        toggleDictation();
      }
    };
    window.addEventListener("keydown", handleDictationKeyDown);
    return () => window.removeEventListener("keydown", handleDictationKeyDown);
  });

  // Sending/streaming stops dictation so the mic never runs during a run.
  useEffect(() => {
    if (isLoading && listening) {
      recognitionRef.current?.stop();
      setListening(false);
    }
  }, [isLoading, listening]);

  useEffect(() => {
    const handleGlobalKeyDown = (event: globalThis.KeyboardEvent) => {
      if (
        (event.metaKey || event.ctrlKey) &&
        event.key.toLowerCase() === "k" &&
        !event.altKey
      ) {
        event.preventDefault();
        const textarea = textareaRef.current;
        if (!textarea) {
          return;
        }
        textarea.focus();
        // Cursor at the end — matches focusing with the mouse.
        const length = textarea.value.length;
        textarea.setSelectionRange(length, length);
        setModelSelectorOpen(false);
      }
    };
    window.addEventListener("keydown", handleGlobalKeyDown);
    return () => window.removeEventListener("keydown", handleGlobalKeyDown);
  }, []);

  // Live models from the completion source (GET /api/models); null while
  // loading or when the fetch fails → fall back to the built-in list.
  const sourceModels = useAvailableModels();

  // The live list plus the current model when it isn't listed (e.g. the
  // backend reports a DEEPAGENTS_MODEL the source doesn't serve), so the
  // selected model is always representable in the menu.
  const models = useMemo(() => {
    const base = sourceModels ?? chatModels;
    if (base.some((m) => m.id === selectedModelId)) {
      return base;
    }
    return [
      ...base,
      {
        id: selectedModelId,
        name: selectedModelId,
        description: "Configured on the backend (not in the list)",
      },
    ];
  }, [selectedModelId, sourceModels]);

  const selectedModelName = useMemo(
    () =>
      models.find((m) => m.id === selectedModelId)?.name ??
      chatModelName(selectedModelId),
    [models, selectedModelId],
  );

  const handleFiles = (files: FileList | null) => {
    if (!files || files.length === 0) {
      return;
    }
    setAttachments((current) => [
      ...current,
      ...Array.from(files).map((file) => ({
        file,
        url: URL.createObjectURL(file),
      })),
    ]);
    // Allow re-picking the same file after removing it.
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const removeAttachment = (index: number) => {
    setAttachments((current) => {
      const target = current[index];
      if (target) {
        URL.revokeObjectURL(target.url);
      }
      return current.filter((_, i) => i !== index);
    });
  };

  const submitForm = (event: FormEvent) => {
    event.preventDefault();
    const text = input.trim();
    if ((!text && attachments.length === 0) || isLoading) {
      return;
    }
    setInput("");
    const files = attachments;
    // Keep the object URLs alive: the sent message's bubble preview still
    // references them (revocation happens on remove / chat switch / unmount).
    setAttachments([]);
    sendMessage({
      parts: [
        ...(text ? [{ text, type: "text" } as const] : []),
        ...files.map(({ file, url }) => ({
          file,
          filename: file.name,
          mediaType: file.type || "application/octet-stream",
          type: "file" as const,
          url,
        })),
      ],
      role: "user",
    });
    textareaRef.current?.focus();
  };

  const uploadDisabled = executeEnabled === false;

  const handlePickFiles = () => {
    if (uploadDisabled) {
      return;
    }
    fileInputRef.current?.click();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (
      event.key === "Enter" &&
      !event.shiftKey &&
      !event.nativeEvent.isComposing
    ) {
      event.preventDefault();
      event.currentTarget.form?.requestSubmit();
    }
  };

  return (
    <form className="flex w-full flex-col gap-2" onSubmit={submitForm}>
      {editingMessage && (
        <div className="flex items-center gap-2 rounded-lg border border-border/60 bg-muted/40 px-3 py-1.5 text-[12px] text-muted-foreground">
          <span>Editing message</span>
          <Button
            className="ml-auto size-5 text-muted-foreground/70 hover:text-foreground"
            onClick={onCancelEdit}
            size="icon-sm"
            type="button"
            variant="ghost"
          >
            <XIcon className="size-3" />
          </Button>
        </div>
      )}

      <div className="flex flex-col gap-1.5 rounded-2xl border border-border/60 bg-card p-2 shadow-[var(--shadow-card)]">
        <div className="flex items-center gap-2">
          <Textarea
            autoFocus
            className="max-h-[200px] min-h-10 flex-1 resize-none border-none bg-transparent px-1 shadow-none focus-visible:ring-0"
            onChange={(event) => setInput(event.target.value)}
            onBlur={() => setInputFocused(false)}
            onFocus={() => setInputFocused(true)}
            onKeyDown={handleKeyDown}
            placeholder="Message..."
            ref={textareaRef}
            rows={1}
            value={input}
          />

          {!inputFocused && !input && (
            <Kbd className="shrink-0">{isMac ? "⌘K" : "Ctrl K"}</Kbd>
          )}
        </div>

        {attachments.length > 0 && (
          <Attachments variant="grid">
            {attachments.map(({ file, url }, index) => (
              <Attachment
                data={{
                  filename: file.name,
                  id: `${file.name}-${index}`,
                  mediaType: file.type || "application/octet-stream",
                  type: "file",
                  url,
                }}
                key={`${file.name}-${index}`}
                onRemove={() => removeAttachment(index)}
                title={`${file.name} (${(file.size / 1024).toFixed(0)} KB)`}
              >
                <AttachmentPreview />
                <AttachmentRemove />
              </Attachment>
            ))}
          </Attachments>
        )}

        <div className="flex items-center gap-1.5">
          <div className="flex min-w-0 items-center gap-1.5">
            <input
              className="hidden"
              multiple
              onChange={(event) => handleFiles(event.target.files)}
              ref={fileInputRef}
              type="file"
            />
            <Button
              aria-label="Attach file"
              className="text-muted-foreground/70"
              disabled={uploadDisabled}
              onClick={handlePickFiles}
              size="sm"
              title={
                uploadDisabled
                  ? "File upload needs the execute tool (EXECUTE_ENABLED=true on the backend)"
                  : "Attach files for the agent to inspect"
              }
              type="button"
              variant="ghost"
            >
              <PlusIcon className="size-4" />
            </Button>

            <ModelSelector
              onOpenChange={setModelSelectorOpen}
              open={modelSelectorOpen}
            >
              <ModelSelectorTrigger
                render={
                  <Button
                    aria-label="Select model"
                    className="text-muted-foreground/70 hover:text-foreground"
                    size="sm"
                    title={selectedModelName}
                    type="button"
                    variant="ghost"
                  >
                    <SparklesIcon data-icon="inline-start" />
                    <span className="max-w-36 truncate">
                      {selectedModelName}
                    </span>
                    <ChevronDownIcon data-icon="inline-end" />
                  </Button>
                }
              />
              <ModelSelectorContent commandDefaultValue={selectedModelId}>
                <ModelSelectorInput placeholder="Search models..." />
                <ModelSelectorList>
                  <ModelSelectorEmpty>No models found</ModelSelectorEmpty>
                  <ModelSelectorGroup>
                    {models.map((model) => (
                      <ModelSelectorItem
                        data-checked={selectedModelId === model.id || undefined}
                        key={model.id}
                        onSelect={() => {
                          setModelSelectorOpen(false);
                          onModelChange(model.id);
                        }}
                        value={model.id}
                      >
                        <div className="flex flex-col gap-0.5">
                          <div className="font-medium">{model.name}</div>
                          <div className="text-[11px] text-muted-foreground">
                            {model.description}
                          </div>
                        </div>
                      </ModelSelectorItem>
                    ))}
                  </ModelSelectorGroup>
                </ModelSelectorList>
              </ModelSelectorContent>
            </ModelSelector>

            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button
                    aria-label="Thinking effort"
                    className="text-muted-foreground/70 hover:text-foreground"
                    size="sm"
                    title={`Thinking effort: ${THINKING_EFFORT_LABELS[thinkingEffort]}`}
                    type="button"
                    variant="ghost"
                  >
                    <BrainIcon data-icon="inline-start" />
                    <span className="max-w-16 truncate">
                      {THINKING_EFFORT_LABELS[thinkingEffort]}
                    </span>
                    <ChevronDownIcon data-icon="inline-end" />
                  </Button>
                }
              >
                <span className="sr-only">Thinking effort</span>
              </DropdownMenuTrigger>

              <DropdownMenuContent
                align="start"
                className="min-w-44"
                side="top"
                sideOffset={8}
              >
                <DropdownMenuGroup>
                  <DropdownMenuLabel className="text-xs font-medium text-muted-foreground">
                    Thinking effort
                  </DropdownMenuLabel>
                  {THINKING_EFFORTS.map((effort) => (
                    <DropdownMenuItem
                      key={effort}
                      onClick={() => onThinkingEffortChange(effort)}
                    >
                      <span className="flex-1">
                        {THINKING_EFFORT_LABELS[effort]}
                      </span>
                      {thinkingEffort === effort && (
                        <CheckIcon className="size-4" />
                      )}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuGroup>
              </DropdownMenuContent>
            </DropdownMenu>

            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button
                    aria-label="MCP tool servers"
                    className="text-muted-foreground/70 hover:text-foreground"
                    size="sm"
                    title={
                      mcpServers.length > 0
                        ? `MCP servers: ${mcpServers.join(", ")}`
                        : "No MCP servers connected"
                    }
                    type="button"
                    variant="ghost"
                  >
                    <PuzzleIcon data-icon="inline-start" />
                    {mcpServers.length > 0 && (
                      <span className="max-w-16 truncate">
                        {mcpServers.length}
                      </span>
                    )}
                    <ChevronDownIcon data-icon="inline-end" />
                  </Button>
                }
              >
                <span className="sr-only">MCP tool servers</span>
              </DropdownMenuTrigger>

              <DropdownMenuContent
                align="start"
                className="min-w-44"
                side="top"
                sideOffset={8}
              >
                <DropdownMenuGroup>
                  <DropdownMenuLabel className="text-xs font-medium text-muted-foreground">
                    Connected MCP servers
                  </DropdownMenuLabel>
                  {mcpServers.length === 0 ? (
                    <DropdownMenuItem disabled>
                      <span className="text-muted-foreground">
                        No servers connected
                      </span>
                    </DropdownMenuItem>
                  ) : (
                    mcpServers.map((server) => (
                      <DropdownMenuItem disabled key={server}>
                        <span className="flex flex-1 items-center gap-2">
                          <span className="size-1.5 rounded-full bg-green-500" />
                          <span className="font-mono text-[12px]">
                            {server}
                          </span>
                        </span>
                      </DropdownMenuItem>
                    ))
                  )}
                </DropdownMenuGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          <div className="ml-auto flex shrink-0 items-center gap-1.5">
            {usage?.context?.current_input_tokens && contextWindow ? (
              <Context
                maxTokens={contextWindow}
                modelId={costModelId}
                usedTokens={usage.context.current_input_tokens}
                usage={aiUsage}
              >
                <ContextTrigger>
                  <ContextIcon />
                </ContextTrigger>
                <ContextContent>
                  <ContextContentHeader />
                  <ContextContentBody>
                    <ContextInputUsage />
                    <ContextOutputUsage />
                    <ContextReasoningUsage />
                    <ContextCacheUsage />
                  </ContextContentBody>
                  <ContextContentFooter>
                    {usage.cost ? (
                      <>
                        <span className="text-muted-foreground">
                          Total cost
                        </span>
                        <span>
                          {new Intl.NumberFormat("en-US", {
                            currency: usage.cost.currency,
                            maximumFractionDigits:
                              usage.cost.total_cost < 0.01 ? 6 : 2,
                            minimumFractionDigits:
                              usage.cost.total_cost < 0.01 ? 4 : 2,
                            style: "currency",
                          }).format(usage.cost.total_cost)}
                        </span>
                      </>
                    ) : undefined}
                  </ContextContentFooter>
                </ContextContent>
              </Context>
            ) : null}

            {speechSupported && (
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <Button
                        aria-label={
                          listening ? "Stop dictation" : "Dictate message"
                        }
                        className={
                          listening
                            ? "bg-foreground/10 text-red-500 hover:bg-foreground/15 hover:text-red-500"
                            : "text-muted-foreground hover:bg-muted hover:text-foreground"
                        }
                        size="icon-sm"
                        type="button"
                        variant="ghost"
                      />
                    }
                  >
                    <MicIcon
                      className={`size-4 ${listening ? "animate-pulse" : ""}`}
                    />
                  </TooltipTrigger>
                  <TooltipContent side="top">
                    <span>{listening ? "Stop dictation" : "Dictation"}</span>
                    <Kbd>{isMac ? "⌘D" : "Ctrl D"}</Kbd>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}

            {runActive && (
              <span
                className="flex shrink-0 items-center gap-1.5 text-[11px] text-muted-foreground"
                title="This chat is still answering in the background"
              >
                <span className="size-1.5 animate-pulse rounded-full bg-foreground/60" />
                Generating…
              </span>
            )}

            {isLoading ? (
              <Button
                aria-label="Stop generation"
                className="bg-foreground text-background hover:bg-foreground/90"
                onClick={stop}
                size="icon-sm"
                type="button"
              >
                <SquareIcon className="size-3 fill-current" />
              </Button>
            ) : (
              <Button
                aria-label="Send message"
                className="bg-foreground text-background hover:bg-foreground/90"
                disabled={
                  (!input.trim() && attachments.length === 0) || runActive
                }
                size="icon-sm"
                title={
                  runActive
                    ? "This chat is still answering in the background"
                    : undefined
                }
                type="submit"
              >
                <ArrowUpIcon className="size-4" />
              </Button>
            )}
          </div>
        </div>
      </div>
    </form>
  );
}
