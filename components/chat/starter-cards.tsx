"use client";

import { motion } from "framer-motion";
import {
  CloudSunIcon,
  CodeIcon,
  ListChecksIcon,
  type LucideIcon,
  NewspaperIcon,
} from "lucide-react";

type Starter = {
  title: string;
  description: string;
  prompt: string;
  icon: LucideIcon;
};

// Quick-start prompts shown on a new chat. The prompts lean on the backend's
// live capabilities (MCP tools like quiz/weather, web search via SearXNG).
const STARTERS: Starter[] = [
  {
    description: "Test your knowledge",
    icon: ListChecksIcon,
    prompt: "Start a quiz for me.",
    title: "Start a quiz",
  },
  {
    description: "What's happening today?",
    icon: NewspaperIcon,
    prompt: "What's the latest news?",
    title: "Check the news",
  },
  {
    description: "Forecast for your city",
    icon: CloudSunIcon,
    prompt: "What's the weather like today?",
    title: "Check the weather",
  },
  {
    description: "Debug or build something",
    icon: CodeIcon,
    prompt: "Help me write some code.",
    title: "Help me code",
  },
];

export function StarterCards({ onPick }: { onPick: (prompt: string) => void }) {
  return (
    <motion.div
      animate={{ opacity: 1, y: 0 }}
      className="grid w-full max-w-4xl grid-cols-2 gap-3 md:grid-cols-4"
      initial={{ opacity: 0, y: 10 }}
      transition={{ delay: 0.6, duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
    >
      {STARTERS.map((starter) => (
        <button
          className="flex flex-col items-start gap-1.5 rounded-xl border border-border/60 bg-card p-3 text-left transition-colors duration-150 hover:border-foreground/30 hover:bg-muted/40"
          key={starter.title}
          onClick={() => onPick(starter.prompt)}
          type="button"
        >
          <starter.icon className="size-4 text-muted-foreground" />
          <span className="text-[13px] font-medium">{starter.title}</span>
          <span className="text-[12px] text-muted-foreground">
            {starter.description}
          </span>
        </button>
      ))}
    </motion.div>
  );
}
