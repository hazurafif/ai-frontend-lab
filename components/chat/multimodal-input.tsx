"use client";

import type { UseChatHelpers } from "@ai-sdk/react";
import { ArrowUpIcon, SquareIcon, XIcon } from "lucide-react";
import type { FormEvent, KeyboardEvent } from "react";
import { useRef, useState } from "react";
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
import { chatModels } from "@/lib/models";
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

  const selectedModel = chatModels.find((m) => m.id === selectedModelId);

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
          onKeyDown={handleKeyDown}
          placeholder="Message..."
          ref={textareaRef}
          rows={1}
          value={input}
        />

        <div className="flex shrink-0 items-center gap-1.5">
          <ModelSelector
            onOpenChange={setModelSelectorOpen}
            open={modelSelectorOpen}
          >
            <ModelSelectorTrigger asChild>
              <Button
                aria-label="Select model"
                className="text-muted-foreground/70 hover:text-foreground"
                size="icon-sm"
                title={selectedModel?.name ?? selectedModelId}
                type="button"
                variant="ghost"
              >
                <SparklesIcon size={14} />
              </Button>
            </ModelSelectorTrigger>
            <ModelSelectorContent>
              <ModelSelectorInput placeholder="Search models..." />
              <ModelSelectorList>
                <ModelSelectorEmpty>No models found</ModelSelectorEmpty>
                <ModelSelectorGroup>
                  {chatModels.map((model) => (
                    <ModelSelectorItem
                      key={model.id}
                      onSelect={() => {
                        setModelSelectorOpen(false);
                        onModelChange(model.id);
                      }}
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
