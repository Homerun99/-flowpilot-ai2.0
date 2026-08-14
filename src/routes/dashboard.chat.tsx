import { createFileRoute, Link } from "@tanstack/react-router";
import { useState, useEffect, useRef, useCallback } from "react";

export const Route = createFileRoute("/dashboard/chat")({
  component: ChatPage,
});

// ── Types ────────────────────────────────────────────────────────────

interface ToolCall {
  name: string;
  args: Record<string, unknown>;
  result?: Record<string, unknown>;
}

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  toolCalls?: ToolCall[];
  isError?: boolean;
  timestamp: string;
}

interface ChatResponse {
  reply: string;
  toolCalls?: ToolCall[];
}

// ── Constants ────────────────────────────────────────────────────────

const MAX_HISTORY = 50;
const STORAGE_KEY_PREFIX = "fp_chat_history_";

const SUGGESTIONS = [
  "What leads came in today?",
  "Show me outstanding invoices",
  "What appointments do I have this week?",
  "Search my documents for...",
];

const WELCOME_MESSAGE: ChatMessage = {
  id: "welcome",
  role: "assistant",
  content:
    "Hi! I'm your AI assistant. I can help you manage leads, invoices, appointments, and answer questions from your documents. What can I help with?",
  timestamp: new Date().toISOString(),
};

// ── Helpers ──────────────────────────────────────────────────────────

function storageKey(workspaceId: string) {
  return `${STORAGE_KEY_PREFIX}${workspaceId}`;
}

function loadHistory(workspaceId: string): ChatMessage[] {
  try {
    const raw = localStorage.getItem(storageKey(workspaceId));
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed.slice(-MAX_HISTORY);
    }
  } catch {}
  return [WELCOME_MESSAGE];
}

function saveHistory(workspaceId: string, messages: ChatMessage[]) {
  try {
    const trimmed = messages.slice(-MAX_HISTORY);
    localStorage.setItem(storageKey(workspaceId), JSON.stringify(trimmed));
  } catch {}
}

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });
}

// ── Sub-components ───────────────────────────────────────────────────

function LoadingDots() {
  return (
    <span className="inline-flex items-center gap-1">
      <span className="h-1.5 w-1.5 rounded-full bg-indigo-400 animate-bounce" style={{ animationDelay: "0ms" }} />
      <span className="h-1.5 w-1.5 rounded-full bg-indigo-400 animate-bounce" style={{ animationDelay: "150ms" }} />
      <span className="h-1.5 w-1.5 rounded-full bg-indigo-400 animate-bounce" style={{ animationDelay: "300ms" }} />
    </span>
  );
}

function ToolCallSection({ calls }: { calls: ToolCall[] }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="mt-2">
      <button
        onClick={() => setOpen(!open)}
        className="inline-flex items-center gap-1.5 text-xs text-gray-400 hover:text-gray-500 dark:hover:text-gray-300 transition-colors cursor-pointer"
      >
        <span>🔧</span>
        <span>
          Used {calls.map((c) => c.name.replace(/_/g, " ")).join(", ")}
        </span>
        <span className="text-[10px]">{open ? "▲" : "▼"}</span>
      </button>
      {open && (
        <div className="mt-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50 p-3 space-y-2">
          {calls.map((call, i) => (
            <div key={i}>
              <p className="text-xs font-mono font-semibold text-indigo-600 dark:text-indigo-400">
                {call.name}({JSON.stringify(call.args)})
              </p>
              {call.result && (
                <pre className="mt-1 text-[10px] text-gray-500 dark:text-gray-400 overflow-x-auto whitespace-pre-wrap">
                  {JSON.stringify(call.result, null, 2)}
                </pre>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Main Component ───────────────────────────────────────────────────

function ChatPage() {
  const workspaceId =
    typeof window !== "undefined"
      ? new URLSearchParams(window.location.search).get("workspace") || "ws_demo"
      : "ws_demo";

  const [messages, setMessages] = useState<ChatMessage[]>(() =>
    loadHistory(workspaceId),
  );
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [showClearConfirm, setShowClearConfirm] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  // Persist history on change
  useEffect(() => {
    saveHistory(workspaceId, messages);
  }, [messages, workspaceId]);

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isLoading]);

  // Auto-resize textarea
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 120) + "px";
  }, [input]);

  const sendMessage = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || isLoading) return;

      const userMsg: ChatMessage = {
        id: crypto.randomUUID(),
        role: "user",
        content: trimmed,
        timestamp: new Date().toISOString(),
      };

      setMessages((prev) => [...prev, userMsg]);
      setInput("");
      setIsLoading(true);

      // Build history for API (last 20 messages, alternating user/assistant)
      const history = messages
        .filter((m) => m.id !== "welcome")
        .slice(-19)
        .concat(userMsg)
        .map((m) => ({
          role: m.role,
          content: m.content,
        }));

      try {
        const resp = await fetch("/api/workspace/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: trimmed, history }),
        });

        if (!resp.ok) {
          throw new Error(`Server error: ${resp.status}`);
        }

        const data: ChatResponse = await resp.json();

        const assistantMsg: ChatMessage = {
          id: crypto.randomUUID(),
          role: "assistant",
          content: data.reply,
          toolCalls: data.toolCalls,
          timestamp: new Date().toISOString(),
        };

        setMessages((prev) => [...prev, assistantMsg]);
      } catch {
        const errorMsg: ChatMessage = {
          id: crypto.randomUUID(),
          role: "assistant",
          content: "Something went wrong. Please try again.",
          isError: true,
          timestamp: new Date().toISOString(),
        };
        setMessages((prev) => [...prev, errorMsg]);
        // Restore input so user doesn't lose what they typed
        setInput(trimmed);
      } finally {
        setIsLoading(false);
      }
    },
    [messages, isLoading],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        sendMessage(input);
      }
    },
    [input, sendMessage],
  );

  const handleClear = useCallback(() => {
    setMessages([WELCOME_MESSAGE]);
    setShowClearConfirm(false);
    try {
      localStorage.removeItem(storageKey(workspaceId));
    } catch {}
  }, [workspaceId]);

  const handleRetry = useCallback(() => {
    // Find the last user message before the error
    const lastUserIdx = [...messages]
      .reverse()
      .findIndex((m) => m.role === "user");
    if (lastUserIdx === -1) return;
    const lastUser = [...messages].reverse()[lastUserIdx];
    // Remove error message and resend
    setMessages((prev) => prev.filter((m) => !m.isError));
    sendMessage(lastUser.content);
  }, [messages, sendMessage]);

  const isEmpty = messages.length === 1 && messages[0].id === "welcome";
  const hasError = messages.some((m) => m.isError);

  return (
    <div className="flex h-dvh flex-col bg-gray-50 dark:bg-gray-950">
      {/* Header */}
      <header className="flex shrink-0 items-center justify-between border-b border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 px-4 md:px-6 py-3">
        <div className="flex items-center gap-3 min-w-0">
          <Link to="/dashboard" className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors shrink-0">
            ←
          </Link>
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-500 to-violet-600 text-sm text-white font-bold shadow-sm">
            AI
          </span>
          <div className="min-w-0">
            <h1 className="text-sm font-bold tracking-tight truncate">
              AI Assistant
            </h1>
            <p className="text-xs text-gray-400 truncate">FlowPilot AI</p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={() => setShowClearConfirm(true)}
            className="rounded-lg px-3 py-1.5 text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors cursor-pointer"
          >
            Clear
          </button>
        </div>
      </header>

      {/* Clear confirmation modal */}
      {showClearConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 px-4">
          <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-6 max-w-sm w-full shadow-xl animate-[fp-deck-in_200ms_ease-out]">
            <h3 className="text-lg font-bold">Clear conversation?</h3>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
              This will remove all messages in this chat. This action cannot be undone.
            </p>
            <div className="flex items-center gap-3 mt-5">
              <button
                onClick={() => setShowClearConfirm(false)}
                className="flex-1 rounded-lg border border-gray-200 dark:border-gray-700 px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={handleClear}
                className="flex-1 rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-500 transition-colors cursor-pointer"
              >
                Clear All
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Messages */}
      <div
        ref={scrollContainerRef}
        className="flex-1 overflow-y-auto px-4 md:px-6 py-6 space-y-4"
      >
        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`flex gap-3 animate-[fp-deck-in_300ms_ease-out] ${
              msg.role === "user" ? "justify-end" : "justify-start"
            }`}
          >
            {/* AI avatar */}
            {msg.role === "assistant" && (
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-500 to-violet-600 text-xs text-white font-bold mt-0.5">
                AI
              </span>
            )}

            {/* Bubble */}
            <div
              className={`max-w-[80%] md:max-w-[70%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
                msg.role === "user"
                  ? "bg-indigo-600 text-white rounded-br-md"
                  : msg.isError
                    ? "bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 rounded-bl-md"
                    : "bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 text-gray-700 dark:text-gray-300 rounded-bl-md shadow-sm"
              }`}
            >
              <div className="whitespace-pre-wrap break-words">
                {msg.content}
              </div>

              {/* Tool calls */}
              {msg.toolCalls && msg.toolCalls.length > 0 && (
                <ToolCallSection calls={msg.toolCalls} />
              )}

              {/* Error retry */}
              {msg.isError && (
                <button
                  onClick={handleRetry}
                  className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-red-600 dark:text-red-400 hover:underline cursor-pointer"
                >
                  ↻ Retry
                </button>
              )}

              {/* Timestamp */}
              <p
                className={`text-[10px] mt-1.5 ${
                  msg.role === "user"
                    ? "text-indigo-200"
                    : "text-gray-400 dark:text-gray-500"
                }`}
              >
                {formatTime(msg.timestamp)}
              </p>
            </div>

            {/* User avatar */}
            {msg.role === "user" && (
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-gray-200 dark:bg-gray-700 text-xs text-gray-500 dark:text-gray-400 font-bold mt-0.5">
                You
              </span>
            )}
          </div>
        ))}

        {/* Loading indicator */}
        {isLoading && (
          <div className="flex items-start gap-3 animate-[fp-deck-in_200ms_ease-out]">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-500 to-violet-600 text-xs text-white font-bold mt-0.5">
              AI
            </span>
            <div className="rounded-2xl rounded-bl-md bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 px-4 py-3 shadow-sm">
              <LoadingDots />
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input area */}
      <div className="shrink-0 border-t border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 px-4 md:px-6 py-3">
        {/* Suggestion chips (empty state) */}
        {isEmpty && (
          <div className="flex flex-wrap gap-2 mb-3">
            {SUGGESTIONS.map((s) => (
              <button
                key={s}
                onClick={() => sendMessage(s)}
                className="rounded-full border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-1.5 text-xs text-gray-600 dark:text-gray-300 hover:border-indigo-300 dark:hover:border-indigo-700 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors cursor-pointer"
              >
                {s}
              </button>
            ))}
          </div>
        )}

        <div className="flex items-end gap-2">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask me anything about your business..."
            rows={1}
            disabled={isLoading}
            className="flex-1 resize-none rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 px-4 py-2.5 text-sm text-gray-900 dark:text-gray-100 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-400 transition-colors max-h-[120px] disabled:opacity-50"
          />

          <button
            onClick={() => sendMessage(input)}
            disabled={isLoading || !input.trim()}
            className="flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-xl bg-indigo-600 text-white hover:bg-indigo-500 transition-colors disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer shadow-sm"
            aria-label="Send message"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="19" x2="12" y2="5" />
              <polyline points="5,12 12,5 19,12" />
            </svg>
          </button>
        </div>

        <p className="text-[10px] text-gray-400 mt-2 text-center">
          AI responses may be inaccurate. Verify important information.
        </p>
      </div>
    </div>
  );
}
