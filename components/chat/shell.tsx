"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useActiveChat } from "@/hooks/use-active-chat";
import type { ChatMessage } from "@/lib/types";
import { ChatHeader } from "./chat-header";
import { Greeting } from "./greeting";
import { Messages } from "./messages";
import { MultimodalInput } from "./multimodal-input";
import { StarterCards } from "./starter-cards";

export function ChatShell() {
  const {
    chatId,
    messages,
    setMessages,
    sendMessage,
    status,
    stop,
    regenerate,
    input,
    setInput,
    isLoading,
    currentModelId,
    setCurrentModelId,
    thinkingEffort,
    setThinkingEffort,
    editMessage,
    rewindMessage,
  } = useActiveChat();

  const [editingMessage, setEditingMessage] = useState<ChatMessage | null>(
    null,
  );

  // Mount-gated empty-state check (hydration rule): server and the client's
  // first render agree on the bottom-docked composer; once mounted we know
  // whether this chat really has no messages and can center it.
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

  const isNewChat = mounted && messages.length === 0 && !isLoading;

  const stopRef = useRef(stop);
  stopRef.current = stop;

  const prevChatIdRef = useRef(chatId);
  useEffect(() => {
    if (prevChatIdRef.current !== chatId) {
      prevChatIdRef.current = chatId;
      stopRef.current();
      setEditingMessage(null);
    }
  }, [chatId]);

  const handleEditMessage = useCallback(
    (msg: ChatMessage) => {
      const text = msg.parts
        ?.filter((part) => part.type === "text")
        .map((part) => part.text)
        .join("");
      setInput(text ?? "");
      setEditingMessage(msg);
    },
    [setInput],
  );

  const handleCancelEdit = useCallback(() => {
    setEditingMessage(null);
    setInput("");
  }, [setInput]);

  const handleSendEditedMessage = useCallback(async () => {
    if (!editingMessage) {
      return;
    }

    const messageToEdit = editingMessage;
    setEditingMessage(null);
    setInput("");
    editMessage(messageToEdit.id, input);
  }, [editMessage, editingMessage, input, setInput]);

  const composer = (
    <MultimodalInput
      chatId={chatId}
      editingMessage={editingMessage}
      input={input}
      isLoading={isLoading}
      messages={messages}
      onCancelEdit={handleCancelEdit}
      onModelChange={setCurrentModelId}
      onThinkingEffortChange={setThinkingEffort}
      selectedModelId={currentModelId}
      sendMessage={editingMessage ? handleSendEditedMessage : sendMessage}
      setInput={setInput}
      setMessages={setMessages}
      status={status}
      stop={stop}
      thinkingEffort={thinkingEffort}
    />
  );

  return (
    <div className="relative flex h-dvh w-full flex-col overflow-hidden">
      <ChatHeader chatId={chatId} />

      <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden bg-background">
        <Messages
          chatId={chatId}
          empty={isNewChat}
          isLoading={isLoading}
          messages={messages}
          onEditMessage={handleEditMessage}
          onRewind={(message) => rewindMessage(message.id)}
          regenerate={regenerate}
          status={status}
        />

        {isNewChat ? (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-6 px-4">
            <Greeting />
            <StarterCards
              onPick={(prompt) =>
                sendMessage({
                  parts: [{ text: prompt, type: "text" }],
                  role: "user",
                })
              }
            />
            <div className="w-full max-w-4xl">{composer}</div>
          </div>
        ) : (
          <div className="sticky bottom-0 z-1 mx-auto flex w-full max-w-4xl gap-2 border-t-0 bg-background px-2 pb-3 md:px-4 md:pb-4">
            {composer}
          </div>
        )}
      </div>
    </div>
  );
}
