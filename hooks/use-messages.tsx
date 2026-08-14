import { useScrollToBottom } from "./use-scroll-to-bottom";

export function useMessages() {
  const {
    containerRef,
    endRef,
    isAtBottom,
    scrollToBottom,
    onViewportEnter,
    onViewportLeave,
    reset,
  } = useScrollToBottom();

  return {
    containerRef,
    endRef,
    isAtBottom,
    onViewportEnter,
    onViewportLeave,
    reset,
    scrollToBottom,
  };
}
