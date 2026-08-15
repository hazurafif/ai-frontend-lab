import { WifiOffIcon } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function OfflinePage() {
  return (
    <div className="flex h-dvh flex-col items-center justify-center gap-6 bg-background px-6 text-center">
      <div className="flex size-14 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
        <WifiOffIcon className="size-7" />
      </div>
      <div className="flex flex-col gap-1.5">
        <h1 className="text-lg font-semibold text-foreground">
          You&apos;re offline
        </h1>
        <p className="max-w-sm text-[13px] leading-relaxed text-muted-foreground">
          AI Chat needs a connection to reach the agent. Check your network and
          try again.
        </p>
      </div>
      <Button render={<Link href="/" />}>
        <WifiOffIcon data-icon="inline-start" />
        Retry
      </Button>
    </div>
  );
}
