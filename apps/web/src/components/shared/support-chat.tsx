'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { MessageCircle, X, Send, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

const API_BASE =
  process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api/v1';

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface SupportChatProps {
  /** When true, renders inline (no floating button / slide panel) */
  embedded?: boolean | undefined;
  /** Pre-fill the first user message and auto-send it */
  initialMessage?: string | undefined;
}

export function SupportChat({ embedded, initialMessage }: SupportChatProps) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const initialSentRef = useRef(false);

  // Auto-scroll on new messages
  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: 'smooth',
    });
  }, [messages]);

  const sendMessage = useCallback(
    async (text: string, currentHistory: ChatMessage[]) => {
      const trimmed = text.trim();
      if (!trimmed || loading) return;

      const userMsg: ChatMessage = { role: 'user', content: trimmed };
      const newHistory = [...currentHistory, userMsg];
      setMessages(newHistory);
      setInput('');
      setLoading(true);

      try {
        const res = await fetch(`${API_BASE}/support/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            message: trimmed,
            history: currentHistory,
          }),
        });

        const data = await res.json();
        const reply: ChatMessage = {
          role: 'assistant',
          content:
            data?.data?.reply ??
            'Sorry, something went wrong. Please try again.',
        };
        setMessages((prev) => [...prev, reply]);
      } catch {
        setMessages((prev) => [
          ...prev,
          {
            role: 'assistant',
            content:
              'Unable to reach support. Please try again or email support@thecodesheriff.com.',
          },
        ]);
      } finally {
        setLoading(false);
      }
    },
    [loading]
  );

  // Handle initialMessage for embedded mode
  useEffect(() => {
    if (initialMessage && !initialSentRef.current) {
      initialSentRef.current = true;
      sendMessage(initialMessage, []);
    }
  }, [initialMessage, sendMessage]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    sendMessage(input, messages);
  };

  // ── Chat panel content (shared between floating & embedded) ──
  const chatPanel = (
    <div
      className={cn(
        'flex flex-col bg-card border-border',
        embedded
          ? 'h-[600px] w-full rounded-lg border'
          : 'h-full w-full'
      )}
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <h2 className="text-sm font-semibold text-foreground">
          CodeSheriff Support
        </h2>
        {!embedded && (
          <button
            onClick={() => setOpen(false)}
            className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
            aria-label="Close support chat"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* Messages */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto px-4 py-3 space-y-3"
      >
        {messages.length === 0 && (
          <p className="text-sm text-muted-foreground text-center mt-8">
            Hi! Ask me anything about CodeSheriff.
          </p>
        )}
        {messages.map((msg, i) => (
          <div
            key={i}
            className={cn(
              'flex',
              msg.role === 'user' ? 'justify-end' : 'justify-start'
            )}
          >
            <div
              className={cn(
                'max-w-[85%] rounded-lg px-3 py-2 text-sm whitespace-pre-wrap',
                msg.role === 'user'
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted text-foreground'
              )}
            >
              {msg.content}
            </div>
          </div>
        ))}
        {loading && (
          <div className="flex justify-start">
            <div className="bg-muted rounded-lg px-3 py-2">
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            </div>
          </div>
        )}
      </div>

      {/* Input */}
      <form
        onSubmit={handleSubmit}
        className="flex items-center gap-2 border-t border-border px-4 py-3"
      >
        <input
          ref={inputRef}
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Type your question..."
          className="flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          disabled={loading}
        />
        <button
          type="submit"
          disabled={loading || !input.trim()}
          className="rounded-md bg-primary p-2 text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          aria-label="Send message"
        >
          <Send className="h-4 w-4" />
        </button>
      </form>
    </div>
  );

  // ── Embedded mode: just render the panel directly ──
  if (embedded) return chatPanel;

  // ── Floating mode: button + slide-out panel ──
  return (
    <>
      {/* Slide-out panel */}
      {open && (
        <>
          {/* Backdrop on mobile */}
          <div
            className="fixed inset-0 z-40 bg-black/30 sm:hidden"
            onClick={() => setOpen(false)}
          />
          <div
            className={cn(
              'fixed top-0 right-0 z-50 h-full border-l border-border bg-card shadow-xl',
              'w-full sm:w-[350px]',
              'animate-in slide-in-from-right duration-200'
            )}
          >
            {chatPanel}
          </div>
        </>
      )}

      {/* Floating button */}
      {!open && (
        <button
          onClick={() => setOpen(true)}
          className="fixed bottom-6 right-6 z-50 flex h-12 w-12 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg hover:bg-primary/90 transition-colors"
          aria-label="Open support chat"
        >
          <MessageCircle className="h-5 w-5" />
        </button>
      )}
    </>
  );
}
