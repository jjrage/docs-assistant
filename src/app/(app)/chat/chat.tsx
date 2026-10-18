"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import type { ChatEvent } from "@/server/ai/answer";
import type { ChatTurn } from "@/server/ai/history";
import type { AnswerSource } from "@/server/ai/sources";
import { AnswerText } from "@/ui/answer-text";
import { AutoRefresh } from "@/ui/auto-refresh";
import { Button } from "@/ui/button";
import { cn } from "@/ui/cn";
import { Alert, Badge, Spinner } from "@/ui/feedback";
import { formatMicroUsd, formatMs } from "@/ui/format";
import { SourceViewer } from "@/ui/viewer/source-viewer";

type LiveTurn = ChatTurn & {
  status?: string;
  notice?: string;
  error?: string;
  streaming?: boolean;
};

const suggestions = [
  "Can I have two dogs? What would I pay?",
  "What happens if my rent is paid on the 6th?",
  "¿Qué hago si hay una fuga de agua de noche?",
  "Can I charge my electric car in the garage?",
];

function sourceLabel(source: AnswerSource): string {
  return source.page
    ? `${source.title}, p. ${source.page}`
    : `${source.title}${source.section ? `, ${source.section}` : ""}`;
}

export function Chat({
  conversationId: initialId,
  initialTurns,
  showCost,
}: {
  conversationId: string | null;
  initialTurns: ChatTurn[];
  showCost: boolean;
}) {
  const router = useRouter();
  const [conversationId, setConversationId] = useState(initialId);
  const [turns, setTurns] = useState<LiveTurn[]>(initialTurns);
  const [busy, setBusy] = useState(false);
  const [question, setQuestion] = useState("");
  const [open, setOpen] = useState<{ turn: string; source: AnswerSource } | null>(null);
  const bottom = useRef<HTMLDivElement>(null);

  // A server refresh (after an answer, or while waiting for staff) brings the saved turns; adopt them once
  // nothing is streaming.
  const [syncedFrom, setSyncedFrom] = useState(initialTurns);
  if (initialTurns !== syncedFrom && !busy) {
    setSyncedFrom(initialTurns);
    setTurns(initialTurns);
  }

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [turns.length, busy]);

  function update(key: string, change: (turn: LiveTurn) => LiveTurn) {
    setTurns((all) => all.map((t) => (t.key === key ? change(t) : t)));
  }

  function apply(key: string, event: ChatEvent) {
    switch (event.type) {
      case "conversation":
        if (!conversationId) {
          setConversationId(event.id);
          window.history.replaceState(null, "", `/chat/${event.id}`);
        }
        break;
      case "status":
        update(key, (t) => ({ ...t, status: event.text }));
        break;
      case "segment":
        update(key, (t) => ({
          ...t,
          status: undefined,
          segments: [...t.segments, { text: "", sources: [] }],
        }));
        break;
      case "text":
        update(key, (t) => {
          const segments = t.segments.length ? [...t.segments] : [{ text: "", sources: [] }];
          const last = segments.at(-1)!;
          segments[segments.length - 1] = { ...last, text: last.text + event.delta };
          return { ...t, status: undefined, segments };
        });
        break;
      case "source":
        update(key, (t) => ({ ...t, sources: [...t.sources, event.source] }));
        break;
      case "cite":
        update(key, (t) => {
          const segments = [...t.segments];
          const last = segments.at(-1);
          if (last)
            segments[segments.length - 1] = { ...last, sources: [...last.sources, event.n] };
          return { ...t, segments };
        });
        break;
      case "handoff":
        update(key, (t) => ({ ...t, handoff: { id: event.id, status: "open", answer: null } }));
        break;
      case "notice":
        update(key, (t) => ({ ...t, notice: event.message }));
        break;
      case "error":
        update(key, (t) => ({ ...t, error: event.message, streaming: false, status: undefined }));
        break;
      case "done":
        update(key, (t) => ({
          ...t,
          key: event.turnId,
          outcome: event.outcome,
          costMicroUsd: event.costMicroUsd,
          totalMs: event.totalMs,
          streaming: false,
          status: undefined,
        }));
        break;
    }
  }

  async function ask(text: string) {
    const trimmed = text.trim();
    if (!trimmed || busy) return;
    const key = `pending-${Date.now()}`;
    setTurns((all) => [
      ...all,
      {
        key,
        question: trimmed,
        segments: [],
        sources: [],
        outcome: null,
        handoff: null,
        costMicroUsd: null,
        totalMs: null,
        streaming: true,
        status: "Searching the documents…",
      },
    ]);
    setQuestion("");
    setBusy(true);
    let currentKey = key;
    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversationId, question: trimmed }),
      });
      if (!response.ok || !response.body) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        update(key, (t) => ({
          ...t,
          streaming: false,
          status: undefined,
          error: body?.error ?? "Something went wrong.",
        }));
        return;
      }
      const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
      let buffer = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += value;
        let newline: number;
        while ((newline = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, newline);
          buffer = buffer.slice(newline + 1);
          if (!line.trim()) continue;
          const event = JSON.parse(line) as ChatEvent;
          apply(currentKey, event);
          if (event.type === "done") currentKey = event.turnId;
        }
      }
    } catch {
      update(currentKey, (t) => ({
        ...t,
        streaming: false,
        status: undefined,
        error: "The connection was lost. Try again.",
      }));
    } finally {
      setBusy(false);
      router.refresh();
    }
  }

  const waitingForStaff = turns.some((t) => t.handoff?.status === "open");

  return (
    <div className="flex min-h-0 flex-1">
      {waitingForStaff && !busy && <AutoRefresh everyMs={15000} maxTimes={40} />}
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex-1 overflow-y-auto px-4 py-6 sm:px-8">
          <div className="mx-auto max-w-2xl space-y-8">
            {turns.length === 0 && (
              <div className="pt-6">
                <h1 className="text-2xl font-semibold tracking-tight text-zinc-900">
                  Ask about your home
                </h1>
                <p className="mt-1.5 text-sm text-zinc-500">
                  Answers come only from the community&apos;s documents, with the page they came
                  from. If the documents don&apos;t cover it, your question goes to the office.
                </p>
                <div className="mt-5 grid gap-2 sm:grid-cols-2">
                  {suggestions.map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => ask(s)}
                      className="rounded-xl bg-white px-4 py-3 text-left text-sm text-zinc-700 shadow-sm ring-1 ring-zinc-200 hover:bg-brand-50 hover:ring-brand-500"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {turns.map((turn) => (
              <TurnView
                key={turn.key}
                turn={turn}
                showCost={showCost}
                openSource={(source) => setOpen({ turn: turn.key, source })}
                active={open?.turn === turn.key ? open.source.n : null}
              />
            ))}
            <div ref={bottom} />
          </div>
        </div>
        <form
          className="border-t border-zinc-200 bg-white px-4 py-3 sm:px-8"
          onSubmit={(e) => {
            e.preventDefault();
            void ask(question);
          }}
        >
          <div className="mx-auto flex max-w-2xl items-end gap-2">
            <textarea
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void ask(question);
                }
              }}
              rows={1}
              maxLength={1000}
              placeholder="Ask a question in any language…"
              aria-label="Your question"
              className="max-h-40 min-h-11 flex-1 resize-none rounded-xl border-0 px-4 py-2.5 text-sm shadow-sm ring-1 ring-inset ring-zinc-300 focus:ring-2 focus:ring-brand-600"
            />
            <Button type="submit" size="lg" className="h-11" disabled={busy || !question.trim()}>
              {busy ? <Spinner /> : "Ask"}
            </Button>
          </div>
        </form>
      </div>

      {open && (
        <aside className="fixed inset-0 z-30 flex flex-col bg-zinc-50 lg:static lg:inset-auto lg:z-auto lg:w-[46%] lg:max-w-3xl lg:border-l lg:border-zinc-200">
          <div className="flex items-start justify-between gap-3 border-b border-zinc-200 bg-white px-5 py-3">
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-zinc-900">{open.source.title}</p>
              <p className="truncate text-xs text-zinc-500">
                {open.source.page ? `Page ${open.source.page}` : "Word document"}
                {open.source.section ? ` · ${open.source.section}` : ""}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-3">
              <Link
                href={`/documents/${open.source.documentId}?page=${open.source.page ?? ""}&b=${open.source.blockStart}-${open.source.blockEnd}`}
                className="text-xs text-brand-700 hover:underline"
              >
                Full page
              </Link>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setOpen(null)}
                aria-label="Close the document"
              >
                Close
              </Button>
            </div>
          </div>
          <div className="flex-1 overflow-y-auto p-4">
            <SourceViewer
              key={`${open.source.documentId}-${open.source.blockStart}-${open.source.blockEnd}`}
              location={open.source}
              compact
            />
          </div>
        </aside>
      )}
    </div>
  );
}

function TurnView({
  turn,
  showCost,
  openSource,
  active,
}: {
  turn: LiveTurn;
  showCost: boolean;
  openSource: (source: AnswerSource) => void;
  active: number | null;
}) {
  const byNumber = new Map(turn.sources.map((s) => [s.n, s]));
  const marker = (n: number) => {
    const source = byNumber.get(n);
    return (
      <button
        type="button"
        onClick={() => source && openSource(source)}
        title={source ? sourceLabel(source) : undefined}
        className={cn(
          "mx-0.5 inline-flex h-4.5 min-w-4.5 -translate-y-1.5 items-center justify-center rounded px-1 align-baseline text-[0.68rem] font-semibold",
          active === n
            ? "bg-brand-700 text-white"
            : "bg-brand-100 text-brand-800 hover:bg-brand-200",
        )}
      >
        {n}
      </button>
    );
  };
  const hasText = turn.segments.some((s) => s.text.trim());

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <p className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-brand-700 px-4 py-2.5 text-sm text-white">
          {turn.question}
        </p>
      </div>
      <div className="text-[0.94rem] text-zinc-800">
        {hasText && <AnswerText segments={turn.segments} marker={marker} />}
        {turn.status && (
          <p className="flex items-center gap-2 text-sm text-zinc-500">
            <Spinner className="size-3.5" /> {turn.status}
          </p>
        )}
        {turn.streaming && !turn.status && !hasText && <Spinner className="text-zinc-400" />}
        {turn.notice && (
          <Alert tone="warning" className="mt-3">
            {turn.notice}
          </Alert>
        )}
        {turn.error && (
          <Alert tone="danger" className="mt-3">
            {turn.error}
          </Alert>
        )}
      </div>

      {turn.sources.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {turn.sources.map((source) => (
            <button
              key={source.n}
              type="button"
              onClick={() => openSource(source)}
              className={cn(
                "inline-flex max-w-full items-center gap-1.5 rounded-lg px-2.5 py-1 text-left text-xs ring-1 ring-inset",
                active === source.n
                  ? "bg-brand-50 text-brand-900 ring-brand-500"
                  : "bg-white text-zinc-700 ring-zinc-200 hover:bg-zinc-50",
              )}
            >
              <span className="font-semibold text-brand-700">{source.n}</span>
              <span className="truncate">{sourceLabel(source)}</span>
            </button>
          ))}
        </div>
      )}

      {turn.handoff && (
        <div className="rounded-xl bg-amber-50 px-4 py-3 text-sm ring-1 ring-inset ring-amber-200">
          {turn.handoff.status === "answered" ? (
            <>
              <p className="flex items-center gap-2 font-medium text-amber-900">
                <Badge tone="success">Answered</Badge> Reply from the property management team
              </p>
              <p className="mt-1.5 whitespace-pre-wrap text-zinc-800">{turn.handoff.answer}</p>
            </>
          ) : (
            <p className="text-amber-900">
              <span className="font-medium">Sent to the property management team.</span> Their reply
              will appear here.
            </p>
          )}
        </div>
      )}

      {showCost && turn.costMicroUsd !== null && turn.totalMs !== null && (
        <p className="text-xs text-zinc-400">
          {formatMs(turn.totalMs)} · {formatMicroUsd(turn.costMicroUsd)}
        </p>
      )}
    </div>
  );
}
