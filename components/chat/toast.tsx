// App toast helper on top of sonner's native API (the shadcn sonner
// component styles the Toaster — bg-popover, border, muted description,
// primary action button). Keeps the call sites' `{description, type, ...}`
// shape while rendering canonical sonner toasts:
//   toast({ type: "error", description: "…" })            → message-only
//   toast({ type: "success", title: "…", description: "…" }) → title + description

import { type ExternalToast, toast as sonnerToast } from "sonner";

type ToastProps = {
  type: "success" | "error";
  description: string;
  /** Optional bold heading above the description. */
  title?: string;
  /** Optional trailing action (e.g. "Open" for completion notifications). */
  action?: { label: string; onClick: () => void };
};

export function toast(props: ToastProps) {
  const options: ExternalToast = {};
  if (props.title !== undefined) {
    options.description = props.description;
  }
  if (props.action) {
    options.action = props.action;
  }
  const message = props.title ?? props.description;
  if (props.type === "error") {
    sonnerToast.error(message, options);
  } else {
    sonnerToast.success(message, options);
  }
}
