import Link from "next/link";

import { demoCompany } from "@/demo/company";
import { DemoBanner } from "@/ui/demo-banner";

import { DemoButtons } from "./login/forms";

const features = [
  [
    "Answers with the exact page",
    "Every claim links to the document and page it came from. One click opens the PDF there, with the passage highlighted.",
  ],
  [
    "Says so when it doesn't know",
    "If the documents don't cover a question, the assistant says it plainly and passes the question to a person, with context.",
  ],
  [
    "Any language in, your documents as they are",
    "Ask in Spanish or Russian about English documents: search works across languages and answers come back in yours.",
  ],
  [
    "Newest rule wins",
    "When an old and a new policy disagree, the answer follows the version in effect and says the rule changed.",
  ],
  [
    "Each company sees only its own",
    "Row-level security in Postgres keeps companies apart, search included. pgTAP tests prove it.",
  ],
  [
    "Cost and speed on record",
    "Every answer is logged with its tokens, price and response time. Tested on 50 questions, results in the README.",
  ],
];

export default function Home() {
  return (
    <>
      <DemoBanner />
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-12 sm:py-20">
        <div className="max-w-2xl">
          <p className="text-sm font-medium text-brand-700">Docs Assistant</p>
          <h1 className="mt-3 text-4xl font-semibold tracking-tight text-zinc-900 sm:text-5xl">
            Answers from your own documents, with the page to prove it.
          </h1>
          <p className="mt-5 text-lg leading-relaxed text-zinc-600">
            Upload policies, contracts and handbooks as PDF or Word. People ask in plain words; the
            assistant answers only from those documents, cites the page, and hands off to your team
            when the answer isn&apos;t there.
          </p>
        </div>

        <section className="mt-10 max-w-3xl">
          <h2 className="text-sm font-semibold text-zinc-900">
            Try it with {demoCompany.name} ({demoCompany.city}), a fictional company with 18
            documents
          </h2>
          <div className="mt-3">
            <DemoButtons layout="row" />
          </div>
          <p className="mt-3 text-xs text-zinc-500">
            Each visitor gets a private copy for 24 hours: your uploads and questions are visible
            only to you. Have an account?{" "}
            <Link href="/login" className="text-brand-700 hover:underline">
              Sign in
            </Link>
          </p>
        </section>

        <section className="mt-16 grid gap-x-8 gap-y-6 sm:grid-cols-2 lg:grid-cols-3">
          {features.map(([title, body]) => (
            <div key={title}>
              <h3 className="text-sm font-semibold text-zinc-900">{title}</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-zinc-600">{body}</p>
            </div>
          ))}
        </section>
      </main>
    </>
  );
}
