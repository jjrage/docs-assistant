"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";

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

/** Sources on the same PDF page (or in the same Word section) share one chip and open together. */
type SourceGroup = {
  key: string;
  numbers: number[];
  documentId: string;
  title: string;
  page: number | null;
  section: string | null;
  ranges: { start: number; end: number }[];
};

function groupSources(sources: AnswerSource[]): SourceGroup[] {
  const groups: SourceGroup[] = [];
  for (const s of sources) {
    const key = `${s.documentId}|${s.page ?? s.section ?? ""}`;
    const range = { start: s.blockStart, end: s.blockEnd };
    const group = groups.find((g) => g.key === key);
    if (group) {
      group.numbers.push(s.n);
      group.ranges.push(range);
    } else {
      groups.push({
        key,
        numbers: [s.n],
        documentId: s.documentId,
        title: s.title,
        page: s.page,
        section: s.section,
        ranges: [range],
      });
    }
  }
  return groups;
}

function groupLabel(group: SourceGroup): string {
  return group.page
    ? `${group.title}, p. ${group.page}`
    : `${group.title}${group.section ? `, ${group.section}` : ""}`;
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
  // After an answer the page reloads its data from the server (the conversation list, saved turns).
  const [refreshing, startRefresh] = useTransition();
  const [conversationId, setConversationId] = useState(initialId);
  const [turns, setTurns] = useState<LiveTurn[]>(initialTurns);
  const [busy, setBusy] = useState(false);
  const [question, setQuestion] = useState("");
  const [open, setOpen] = useState<{ turn: string; group: SourceGroup } | null>(null);
  const bottom = useRef<HTMLDivElement>(null);

  // The same chat stays mounted across /chat and /chat?c=<id>. Another conversation (a link in the list, or
  // "New question") starts over; the one this chat just created only gets its URL, nothing resets.
  const [shownId, setShownId] = useState(initialId);
  const [syncedFrom, setSyncedFrom] = useState(initialTurns);
  if (initialId !== shownId) {
    setShownId(initialId);
    if (initialId !== conversationId) {
      setConversationId(initialId);
      setTurns(initialTurns);
      setSyncedFrom(initialTurns);
      setOpen(null);
    }
  } else if (initialTurns !== syncedFrom && !busy) {
    // A server refresh (after an answer, or while waiting for staff) brings the saved turns. A turn that
    // failed was never saved: if it came after them, it stays on screen with its error.
    const saved = new Set(initialTurns.map((t) => t.key));
    const lastSaved = turns.findLastIndex((t) => saved.has(t.key));
    const failed = turns.slice(lastSaved + 1).filter((t) => t.error);
    setSyncedFrom(initialTurns);
    setTurns(failed.length ? [...initialTurns, ...failed] : initialTurns);
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
          window.history.replaceState(null, "", `/chat?c=${event.id}`);
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
      startRefresh(() => router.refresh());
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
                openGroup={(group) => setOpen({ turn: turn.key, group })}
                active={open?.turn === turn.key ? open.group.key : null}
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
              disabled={refreshing}
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
            <Button
              type="submit"
              size="lg"
              className="h-11"
              disabled={busy || refreshing || !question.trim()}
            >
              {busy ? <Spinner /> : "Ask"}
            </Button>
          </div>
        </form>
      </div>

      {open && (
        <aside className="fixed inset-0 z-30 flex flex-col bg-zinc-50 lg:static lg:inset-auto lg:z-auto lg:w-[46%] lg:max-w-3xl lg:border-l lg:border-zinc-200">
          <div className="flex items-start justify-between gap-3 border-b border-zinc-200 bg-white px-5 py-3">
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-zinc-900">{open.group.title}</p>
              <p className="truncate text-xs text-zinc-500">
                {open.group.page ? `Page ${open.group.page}` : "Word document"}
                {open.group.section ? ` · ${open.group.section}` : ""}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-3">
              <Link
                href={`/documents/${open.group.documentId}?page=${open.group.page ?? ""}&b=${open.group.ranges.map((r) => `${r.start}-${r.end}`).join(",")}`}
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
              key={`${open.turn}-${open.group.key}`}
              location={{
                documentId: open.group.documentId,
                page: open.group.page,
                ranges: open.group.ranges,
              }}
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
  openGroup,
  active,
}: {
  turn: LiveTurn;
  showCost: boolean;
  openGroup: (group: SourceGroup) => void;
  active: string | null;
}) {
  const groups = groupSources(turn.sources);
  const marker = (n: number) => {
    const group = groups.find((g) => g.numbers.includes(n));
    return (
      <button
        type="button"
        onClick={() => group && openGroup(group)}
        title={group ? groupLabel(group) : undefined}
        className={cn(
          "mx-0.5 inline-flex h-4.5 min-w-4.5 -translate-y-1.5 items-center justify-center rounded px-1 align-baseline text-[0.68rem] font-semibold",
          group && active === group.key
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
          {groups.map((group) => (
            <button
              key={group.key}
              type="button"
              onClick={() => openGroup(group)}
              className={cn(
                "inline-flex max-w-full items-center gap-1.5 rounded-lg px-2.5 py-1 text-left text-xs ring-1 ring-inset",
                active === group.key
                  ? "bg-brand-50 text-brand-900 ring-brand-500"
                  : "bg-white text-zinc-700 ring-zinc-200 hover:bg-zinc-50",
              )}
            >
              <span className="font-semibold text-brand-700">{group.numbers.join(", ")}</span>
              <span className="truncate">{groupLabel(group)}</span>
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
