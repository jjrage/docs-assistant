"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTransition } from "react";

import { cn } from "@/ui/cn";
import { Spinner } from "@/ui/feedback";

import { switchRole } from "./actions";

const memberLinks = [
  { href: "/chat", label: "Ask" },
  { href: "/documents", label: "Documents" },
];

const adminLinks = [
  { href: "/admin/inbox", label: "Inbox" },
  { href: "/admin/faq", label: "Frequent questions" },
  { href: "/admin/log", label: "Answer log" },
];

export function Nav(props: { admin: boolean; openHandoffs: number; compact?: boolean }) {
  return <Links {...props} pathname={usePathname()} />;
}

export function NavFallback({ compact = false }: { compact?: boolean }) {
  return <Links admin={false} openHandoffs={0} compact={compact} pathname="" />;
}

function Links({
  admin,
  openHandoffs,
  compact,
  pathname,
}: {
  admin: boolean;
  openHandoffs: number;
  compact?: boolean;
  pathname: string;
}) {
  const links = admin ? [...memberLinks, ...adminLinks] : memberLinks;
  return (
    <nav
      className={cn(compact ? "-mx-1 flex gap-1 overflow-x-auto" : "flex flex-col gap-0.5 px-3")}
    >
      {links.map((link) => {
        const active = pathname.startsWith(link.href);
        return (
          <Link
            key={link.href}
            href={link.href}
            className={cn(
              "flex items-center justify-between gap-2 whitespace-nowrap rounded-lg px-3 py-2 text-sm",
              active ? "bg-brand-50 font-medium text-brand-800" : "text-zinc-600 hover:bg-zinc-100",
            )}
          >
            {link.label}
            {link.href === "/admin/inbox" && openHandoffs > 0 && (
              <span className="rounded-full bg-amber-500 px-1.5 text-xs font-semibold text-white">
                {openHandoffs}
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}

/** Demo sandboxes: switch between the property manager's and a resident's view of the same company. */
export function RoleSwitch({ role }: { role: "admin" | "member" }) {
  const [pending, startTransition] = useTransition();
  const option = (value: "admin" | "member", label: string) => (
    <button
      type="button"
      disabled={pending || role === value}
      onClick={() => startTransition(() => switchRole(value))}
      className={cn(
        "flex-1 rounded-md px-2 py-1 text-xs font-medium transition",
        role === value ? "bg-white text-zinc-900 shadow-sm" : "text-zinc-500 hover:text-zinc-800",
      )}
    >
      {label}
    </button>
  );
  return (
    <div>
      <p className="mb-1 flex items-center gap-1.5 text-xs text-zinc-500">
        View as {pending && <Spinner className="size-3" />}
      </p>
      <div className="flex gap-1 rounded-lg bg-zinc-100 p-0.5">
        {option("member", "Resident")}
        {option("admin", "Manager")}
      </div>
    </div>
  );
}
