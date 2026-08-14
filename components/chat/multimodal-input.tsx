"use client";

import type { UseChatHelpers } from "@ai-sdk/react";
import { ArrowUpIcon, ChevronDownIcon, SquareIcon, XIcon } from "lucide-react";
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
import { Textarea } from "@/components/ui/textarea";
import { useAvailableModels } from "@/hooks/use-available-models";
import { chatModelName, chatModels } from "@/lib/models";
import type { ChatMessage } from "@/lib/types";
import { SparklesIcon } from "./icons";

type MultimodalInputProps = {
  chatId: string;
  editingMessage: ChatMessage | null;
  input: string;
  isLoading: boolean;
  messages: ChatMessage[];
  onCancelEdit: () => void;
  onModelChange: (modelId: string) => void;
  selectedModelId: string;
  sendMessage: UseChatHelpers<ChatMessage>["sendMessage"];
  setInput: (value: string) => void;
  setMessages: UseChatHelpers<ChatMessage>["setMessages"];
  status: UseChatHelpers<ChatMessage>["status"];
  stop: UseChatHelpers<ChatMessage>["stop"];
};
export function MultimodalInput({
  editingMessage,
  input,
  isLoading,
  onCancelEdit,
  onModelChange,
  selectedModelId,
  sendMessage,
  setInput,
  stop,
}: MultimodalInputProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [modelSelectorOpen, setModelSelectorOpen] = useState(false);
  const [inputFocused, setInputFocused] = useState(false);
  // Mount-gated platform check (hydration rule): server + first client
  // render show the macOS glyph, then flip to the Ctrl label on other OSes.
  const [isMac, setIsMac] = useState(true);

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

  const submitForm = (event: FormEvent) => {
    event.preventDefault();
    const text = input.trim();
    if (!text || isLoading) {
      return;
    }
    setInput("");
    sendMessage({ parts: [{ text, type: "text" }], role: "user" });
    textareaRef.current?.focus();
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

      <div className="flex items-end gap-2 rounded-2xl border border-border/60 bg-card p-2 shadow-[var(--shadow-card)]">
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
          <kbd className="pointer-events-none shrink-0 select-none self-center rounded-md border border-border/60 bg-muted/60 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground/70">
            {isMac ? "⌘K" : "Ctrl K"}
          </kbd>
        )}

        <div className="flex shrink-0 items-center gap-1.5">
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
                  <span className="max-w-36 truncate">{selectedModelName}</span>
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
    </form>
  );
}
