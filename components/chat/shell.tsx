"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useActiveChat } from "@/hooks/use-active-chat";
import type { ChatMessage } from "@/lib/types";
import { ChatHeader } from "./chat-header";
import { Messages } from "./messages";
import { MultimodalInput } from "./multimodal-input";

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
    editMessage,
  } = useActiveChat();

  const [editingMessage, setEditingMessage] = useState<ChatMessage | null>(
    null,
  );

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

  return (
    <div className="flex h-dvh w-full flex-col overflow-hidden">
      <ChatHeader chatId={chatId} />

      <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden bg-background">
        <Messages
          chatId={chatId}
          isLoading={isLoading}
          messages={messages}
          onEditMessage={handleEditMessage}
          regenerate={regenerate}
          status={status}
        />

        <div className="sticky bottom-0 z-1 mx-auto flex w-full max-w-4xl gap-2 border-t-0 bg-background px-2 pb-3 md:px-4 md:pb-4">
          <MultimodalInput
            chatId={chatId}
            editingMessage={editingMessage}
            input={input}
            isLoading={isLoading}
            messages={messages}
            onCancelEdit={handleCancelEdit}
            onModelChange={setCurrentModelId}
            selectedModelId={currentModelId}
            sendMessage={editingMessage ? handleSendEditedMessage : sendMessage}
            setInput={setInput}
            setMessages={setMessages}
            status={status}
            stop={stop}
          />
        </div>
      </div>
    </div>
  );
}
