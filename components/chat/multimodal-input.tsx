"use client";

import type { UseChatHelpers } from "@ai-sdk/react";
import {
  ArrowUpIcon,
  BrainIcon,
  CheckIcon,
  ChevronDownIcon,
  FileIcon,
  PaperclipIcon,
  SquareIcon,
  XIcon,
} from "lucide-react";
import type { FormEvent, KeyboardEvent } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
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
import { Textarea } from "@/components/ui/textarea";
import { useAvailableModels } from "@/hooks/use-available-models";
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

/** 12345 → "12.3k", 1234567 → "1.2M". */
function formatTokens(n: number): string {
  if (n >= 1_000_000) {
    return `${(n / 1_000_000).toFixed(1)}M`;
  }
  if (n >= 1_000) {
    return `${(n / 1_000).toFixed(1)}k`;
  }
  return String(n);
}

function UsagePill({ usage }: { usage: ThreadUsage }) {
  const context = usage.context;
  if (!context?.context_window) {
    return null;
  }
  const utilization = Math.round((context.utilization ?? 0) * 100);
  const title = [
    `Context: ${context.current_input_tokens.toLocaleString()} / ${context.context_window.toLocaleString()} tokens`,
    usage.usage
      ? `Cumulative: ${usage.usage.input_tokens.toLocaleString()} in / ${usage.usage.output_tokens.toLocaleString()} out (${usage.usage.runs} runs)`
      : null,
    `${usage.messages.count} messages`,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div
      className="hidden shrink-0 items-center gap-1.5 rounded-full border border-border/60 bg-muted/40 px-2.5 py-1 text-[11px] font-medium text-muted-foreground transition-opacity duration-150 sm:flex"
      title={title}
    >
      <span>
        {formatTokens(context.current_input_tokens)} /{" "}
        {formatTokens(context.context_window)}
      </span>
      <span className="text-muted-foreground/50">· {utilization}%</span>
    </div>
  );
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
  const [attachments, setAttachments] = useState<File[]>([]);
  // Whether the backend can execute shell commands (GET /health
  // execute.enabled, EXECUTE_ENABLED) — required for the agent to reach
  // uploaded files. null = unknown (still loading / offline → allow).
  const [executeEnabled, setExecuteEnabled] = useState<boolean | null>(null);
  // Context window + token usage from GET /threads/{id}/usage (backend
  // ThreadUsageOut). Refetches when the thread changes or a run settles;
  // hidden while a run is in progress, and for new chats / guests (no
  // server report yet — 404/401 → null).
  const [usage, setUsage] = useState<ThreadUsage | null>(null);

  useEffect(() => {
    let cancelled = false;
    setUsage(null);
    if (status === "submitted" || status === "streaming") {
      return;
    }
    fetchThreadUsage(chatId)
      .then((next) => {
        if (!cancelled) {
          setUsage(next);
        }
      })
      .catch(() => {
        // offline / no report — leave the readout hidden
      });
    return () => {
      cancelled = true;
    };
  }, [chatId, status]);
  // Mount-gated platform check (hydration rule): server + first client
  // render show the macOS glyph, then flip to the Ctrl label on other OSes.
  const [isMac, setIsMac] = useState(true);

  // Backend execute capability for the upload button (EXECUTE_ENABLED).
  useEffect(() => {
    let cancelled = false;
    fetchBackendHealth()
      .then((health) => {
        if (!cancelled) {
          setExecuteEnabled(health?.execute?.enabled ?? null);
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
    setAttachments([]);
  }, [chatId]);

  // Global ⌘K / Ctrl+K — focus the message input from anywhere in the app.
  useEffect(() => {
    setIsMac(/mac/i.test(navigator.platform || navigator.userAgent));
  }, []);

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
    if (!files) {
      return;
    }
    setAttachments((current) => [...current, ...Array.from(files)]);
    // Allow re-picking the same file after removing it.
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const submitForm = (event: FormEvent) => {
    event.preventDefault();
    const text = input.trim();
    if ((!text && attachments.length === 0) || isLoading) {
      return;
    }
    setInput("");
    const files = attachments;
    setAttachments([]);
    sendMessage({
      parts: [
        ...(text ? [{ text, type: "text" } as const] : []),
        ...files.map((file) => ({
          file,
          mediaType: file.type || "application/octet-stream",
          type: "file" as const,
          url: URL.createObjectURL(file),
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
            <kbd className="pointer-events-none shrink-0 select-none rounded-md border border-border/60 bg-muted/60 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground/70">
              {isMac ? "⌘K" : "Ctrl K"}
            </kbd>
          )}
        </div>

        {attachments.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {attachments.map((file, index) => (
              <div
                className="flex max-w-56 items-center gap-1.5 rounded-lg border border-border/60 bg-muted/40 py-1 pr-1 pl-2 text-[12px] text-muted-foreground"
                key={`${file.name}-${index}`}
                title={`${file.name} (${(file.size / 1024).toFixed(0)} KB)`}
              >
                <FileIcon className="size-3.5 shrink-0" />
                <span className="truncate">{file.name}</span>
                <button
                  aria-label={`Remove ${file.name}`}
                  className="rounded p-0.5 text-muted-foreground/60 transition-colors hover:text-destructive"
                  onClick={() =>
                    setAttachments((current) =>
                      current.filter((_, i) => i !== index),
                    )
                  }
                  type="button"
                >
                  <XIcon className="size-3" />
                </button>
              </div>
            ))}
          </div>
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
              <PaperclipIcon className="size-4" />
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
          </div>

          <div className="ml-auto flex shrink-0 items-center gap-1.5">
            {usage && <UsagePill usage={usage} />}

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
                disabled={!input.trim()}
                size="icon-sm"
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
