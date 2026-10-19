# Docs Assistant

**An assistant that answers from a company's own documents, cites the exact page, and hands off to a human when
the answer isn't there.**
A company uploads its policies, contracts and handbooks as PDF or Word. People ask in plain words, in any
language. The assistant answers only from those documents, and every claim links to the page it came from: one click
opens the document there with the passage highlighted. When the documents don't cover a question, it says so instead
of guessing and passes the question to the team; the reply appears in the same chat.

The demo company is **Ostervale Property Management**, a fictional property manager running Larkfen Commons, an
apartment community in Lexington, KY. Its 18 documents (a lease, house rules, an old and a new pet policy, a fee
schedule, maintenance procedures, move-in and move-out checklists and more; 14 PDF, 4 Word) were written for this
demo. Nothing in the app is specific to property management: each company is a separate tenant with its own documents.

> **Status:** feature-complete. Live demo: _link after deployment_. One click gives you a private copy of the demo
> company for 24 hours, as a resident or as the property manager.

<!-- Demo video and screenshots go here. -->

## What a company gets

- **Answers people can check.** Each answer cites the document and page; the source opens beside the chat with the
  cited lines highlighted. Questions in Spanish or Russian get answers in Spanish or Russian from English documents.
- **No made-up answers.** If the documents don't say it, the assistant says so plainly and hands the question to the
  team, with what it searched and what came closest. The reply goes back to the person who asked.
- **The current rule, not an old one.** Documents carry an effective date and can replace an older version; when
  versions disagree, the answer follows the one in effect and mentions that the rule changed.
- **A list of what to write next.** Questions are grouped by meaning, across wording and languages, so the team
  sees which topics come up and which ones the documents don't cover.
- **Known cost per answer.** Every answer is logged with its tokens, price and response time; the eval below
  measures accuracy and cost on three models, so the model is a business decision, not a guess.

## Guarantees, enforced and tested

| Guarantee                                                   | How                                                                                                                        | Checked by                                                                |
| ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Company A never sees company B's documents, search included | Row-level security on every table, read-only grants; the search function runs with the signed-in user's rights             | 44 pgTAP checks, including a search called with another company's ids     |
| A demo visitor's uploads stay private                       | Each visitor gets a sandbox company that reads the sample documents read-only and keeps its own uploads, questions and log | pgTAP                                                                     |
| Answers come only from the documents                        | Passages reach Claude as search results with citations on; the prompt forbids filling gaps from general knowledge          | 50-question eval (below)                                                  |
| Every claim links to its page                               | Citations name the exact paragraphs; each passage carries its document, page and section                                   | Eval: right page cited                                                    |
| A question the documents don't answer reaches a person      | A hand-off tool creates the inbox item; the chat shows "sent to the team" only from the server's record                    | Eval: 10 questions not in the documents; end-to-end test of the full loop |
| Documents can't give the assistant orders                   | Document text is passed only as search results, never as instructions                                                      | Eval: 2 prompt injections planted in a document                           |
| Keys and files stay on the server                           | Server-only modules; files are read through short-lived signed URLs after an access check                                  | Code review, pgTAP (no direct bucket access)                              |

## The problem

Companies already have the answers, in documents nobody reads: a 12-page lease, a pet policy that changed in March,
a fee table. Residents and employees ask the office instead, the office answers the same questions every day, and a
chatbot on top of the documents is only useful if people can trust it: it must show where an answer comes from,
follow the current version, and admit when the documents are silent.

## How it works

```mermaid
flowchart LR
  subgraph Browser
    Chat["Chat"]
    Viewer["Document viewer<br/>(pdf.js text layer)"]
    Admin["Documents, inbox,<br/>frequent questions, log"]
  end
  subgraph App["Next.js 16"]
    Route["/api/chat<br/>(streamed answer)"]
    Answer["Answer loop"]
    Upload["Upload + indexing"]
  end
  subgraph Supabase
    DB[("Postgres 17<br/>RLS, pgvector, full-text")]
    Files[("Storage<br/>(private)")]
  end
  Chat --> Route --> Answer
  Answer -- "hybrid search<br/>with the user's rights" --> DB
  Answer <-- "search results with citations" --> Claude["Claude API"]
  Answer --> Voyage["Voyage AI<br/>(embeddings)"]
  Admin --> Upload
  Upload -- "signed upload URL" --> Files
  Upload --> Voyage
  Upload --> DB
  Viewer -- "signed URL after an access check" --> Files
```

**Indexing.** A PDF's text layer has positioned runs of text, not paragraphs, so the layout is rebuilt from
geometry: font size finds headings and their levels, gaps find table cells, indentation finds list items, and
lines repeated at the edge of every page (running headers, page numbers) are dropped. Word documents keep their
heading styles. Each paragraph, list item or table row becomes a block with its page and section path; blocks are
grouped into passages of one section and one page and embedded with Voyage AI (`voyage-4`, multilingual).

**Answering.** The question is embedded and searched twice in Postgres, by meaning (pgvector) and by words
(full-text), and the two rankings are merged (reciprocal rank fusion). The best passages go to Claude as search
results, one text block per paragraph, with citations on. Claude can search again with its own query (for
example in English for a question in another language) or hand the question to the team. The answer streams to
the browser; each citation names a range of paragraphs in a passage whose source is the viewer link
`/documents/<id>?page=<n>#b<first paragraph>`, so it resolves to document, page and lines with no further lookup.

**Viewing.** The cited page opens in pdf.js; the cited paragraphs are found in the page's text layer by comparing
text without whitespace, cell separators or hyphens, and highlighted. Word documents are shown from their blocks.

## Evals

<!-- EVAL RESULTS -->

## Cost per answer

<!-- COST -->

## What was hard, and how it is solved

**Pages and paragraphs from a PDF.** Citations are only as good as the units they point at. pdf.js gives runs of
text with coordinates; tables come out as cells on a line, a wrapped cell as a second line, a numbered list as a
number to the left of indented text. The parser rebuilds lines by baseline, splits cells at gaps wider than a space,
joins a wrapped cell back into its row when its text lines up with the row's columns, and treats the most common
font size as body text so that larger lines become headings ranked by size. It is tested on PDFs rendered from known
Markdown, where every heading, table row and list item is checked.

**Isolation that covers search.** Row-level security protects tables, but a search function that runs with the
service key would happily return another company's passages to the model. Here the search runs as the signed-in
user (`security invoker`), so even a wrong company id from the application returns nothing it shouldn't; pgTAP
calls it that way to prove it. The search is also exact rather than approximate: an approximate vector index scans
all companies first and filters afterwards, which drops neighbours and returns fewer results. With hundreds of
passages per company, an exact scan inside the company is faster anyway.

**"I don't know" that reaches someone.** Two model behaviours had to be handled. Claude Opus 5.5 returns text it
writes before a tool call as hidden progress notes, so "the documents don't cover this" written before the hand-off
never reached the person; the prompt now asks for the hand-off first and the explanation after. In the eval pilot,
Claude Haiku 5.5 sometimes wrote "I've passed your question to the team" without calling the hand-off tool, so
nobody would ever reply; the chat's "sent to the team" notice comes only from the server's record, and the eval now
counts such an answer as wrong.

**A public demo without shared mess.** Every visitor gets a private copy of the demo company for a day. Copying 18
indexed documents per visitor would multiply storage, so a sandbox instead points at the template company: row-level
security lets its members read the template's documents and passages, while uploads, questions, hand-offs and the
log stay in the sandbox. A daily job deletes expired sandboxes.

**Old and new versions of a rule.** Each search result's title says when its document took effect and whether a
newer document replaced it, so when the 2024 and 2026 pet policies disagree, the answer gives the 2026 values and
says the rule changed.

## Tests

- **40 unit tests** (Vitest): PDF and Word parsing on fixture documents, chunking, citation highlighting, answer
  rendering, cost, question grouping, the log summary.
- **44 pgTAP checks**: deny-by-default grants, row-level security between companies and sandboxes, search with the
  caller's rights, the private bucket, the append-only log.
- **12 integration tests** against the local Supabase stack: indexing PDF and Word files, failure reasons, the
  answer loop end to end against a local stand-in for the Claude API (citations, extra search, hand-off, refusal),
  and hand-off replies scoped to the admin's company.
- **4 end-to-end tests** (Playwright): a visitor starts a demo and reads documents; the manager's pages; an answer
  whose source opens with the passage highlighted; a question the documents don't answer reaching the manager and the
  reply reaching the resident.
- **The 50-question eval** above, against the real models.

```bash
npm run check        # typecheck, lint, format check, unit tests
npm run test:db      # pgTAP and integration tests (needs the local Supabase stack)
npm run test:e2e     # Playwright against the seeded demo (E2E_AI=1 adds the steps that need the AI keys)
npm run eval         # the eval, needs ANTHROPIC_API_KEY and VOYAGE_API_KEY
```

## Running it locally

Requirements: Node.js 24, Docker Desktop, an Anthropic API key and a Voyage AI API key.

```bash
npm install
npm run db:start               # local Supabase (API :44621, Studio :44623, mail :44624)
cp .env.example .env.local     # fill in the local keys from `npx supabase status -o env` and the AI keys
npm run db:seed                # the demo company: 18 documents, indexed with Voyage AI
npm run dev                    # http://localhost:3000
```

The demo documents are written in Markdown (`demo/content/docs`) and rendered to PDF and Word with
`npm run demo:docs`. The seeded company also has two fixed accounts, `manager@ostervale.example` and
`resident@ostervale.example`, with the password `ostervale-local-demo` on a local database (a deployment takes it
from `DEMO_USER_PASSWORD`).

## Project layout

```
src/app/              pages: landing, sign-in, chat, documents and viewer, admin; API routes
src/server/documents/ parsing PDF and Word into blocks, chunking, indexing, upload, file access
src/server/search/    embeddings (Voyage AI) and hybrid search
src/server/ai/        the answer loop, prompt and tools, citations to sources, pricing, conversation storage
src/server/admin/     inbox, frequent questions, answer log
src/ui/               UI components, the document viewer
src/demo/             the demo company and the Markdown-to-PDF/Word renderer
demo/                 demo documents: Markdown sources and rendered files
supabase/             migrations (schema, row-level security, search) and pgTAP tests
evals/                questions, runner, judge, results
tests/                integration and end-to-end tests
```

## Later

Ideas kept out of scope on purpose:

- Scanned documents (OCR).
- Slack, Microsoft Teams, Zendesk or Intercom as places to ask.
- Turning a staff reply into a suggested addition to the documents.
- Per-document access (for example HR documents for managers only) on top of per-company isolation.
- An e-mail to the person when the team replies.

## License

[MIT](LICENSE)
