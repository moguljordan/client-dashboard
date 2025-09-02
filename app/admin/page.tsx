"use client";

import { useEffect, useMemo, useState, useCallback, useRef } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { db } from "@/lib/firebase";
import {
  collectionGroup,
  onSnapshot,
  orderBy,
  query,
  Timestamp,
  DocumentData,
  updateDoc,
  doc,
  serverTimestamp,
  getDocs,
  getDoc,
  collection,
  limit,
} from "firebase/firestore";
import { useRouter } from "next/navigation";
import {
  DragDropContext,
  Droppable,
  Draggable,
  DropResult,
} from "@hello-pangea/dnd";
import { createPortal } from "react-dom";

const DASHBOARD_ROUTE = "/dashboard";

// ——— Types ———
type ProjectStatus = "new" | "in-progress" | "review" | "done";

interface Project {
  id: string;
  title: string;
  description: string;
  status: ProjectStatus;
  dueDate?: string; // YYYY-MM-DD (normalized)
  position?: number;
  createdAt?: Timestamp | null;
  updatedAt?: Timestamp | null;
  priority?: "low" | "medium" | "high";
  tags?: string[];
  assignedTo?: string;
  clientId?: string;
  clientName?: string;
  __parentPath?: string;
}

type ViewMode = "table" | "kanban";

interface InvoiceRow {
  id: string;
  title?: string;
  amount?: number | string;
  status?: string;
  dueDate?: string;
  url?: string;
}

type ClientProfile = {
  displayName?: string;
  email?: string;
  company?: string;
  photoURL?: string;
};

// ——— Helpers ———
function humanDate(d?: string) {
  if (!d) return "—";
  const dt = new Date(d);
  return isNaN(+dt) ? d! : dt.toLocaleDateString();
}
function tsToDateStr(v: any | undefined): string | undefined {
  if (!v) return undefined;
  if (typeof v === "string") return v.includes("T") ? v.split("T")[0] : v;
  if (v?.toDate) return v.toDate().toISOString().split("T")[0];
  return undefined;
}
function daysUntil(d?: string) {
  if (!d) return Infinity;
  const today = new Date();
  const target = new Date(d);
  const diffMs =
    target.getTime() - new Date(today.setHours(0, 0, 0, 0)).getTime();
  return Math.floor(diffMs / (1000 * 60 * 60 * 24));
}
function importanceScore(p: Project) {
  let score = 0;
  const du = daysUntil(p.dueDate);
  if (p.dueDate) {
    if (du < 0) score += 100;
    else if (du <= 3) score += 50;
  }
  if (p.priority === "high") score += 40;
  else if (p.priority === "medium") score += 20;
  if (p.status === "in-progress") score += 15;
  else if (p.status === "review") score += 10;
  else if (p.status === "new") score += 5;
  return score;
}
const cn = (...s: (string | false | null | undefined)[]) =>
  s.filter(Boolean).join(" ");

const makeDragId = (p: Project) => `${p.clientId ?? "unknown"}::${p.id}`;
const parseDragId = (dragId: string) => {
  const [clientId, id] = dragId.split("::");
  return { clientId, id };
};

function DraggablePortal({
  children,
  isDragging,
}: {
  children: React.ReactNode;
  isDragging: boolean;
}) {
  if (!isDragging) return <>{children}</>;
  return createPortal(children as any, document.body);
}

// ——— Client badge (text only: name + optional email) ———
function ClientBadge({ p, profile }: { p: Project; profile?: ClientProfile }) {
  const name =
    p.clientName ||
    profile?.displayName ||
    profile?.company ||
    p.clientId ||
    "Unknown";
  const email = profile?.email;
  return (
    <div className="min-w-0 text-xs">
      <div className="font-medium text-zinc-900 dark:text-zinc-100 truncate">
        {name}
      </div>
      {email ? (
        <div className="text-zinc-500 dark:text-zinc-400 truncate">{email}</div>
      ) : null}
    </div>
  );
}

// ——— Component ———
export default function AdminPage() {
  const { user, role } = useAuth();
  const router = useRouter();

  const [projects, setProjects] = useState<Project[]>([]);
  const [view, setView] = useState<ViewMode>("table");
  const [statusFilter, setStatusFilter] = useState<ProjectStatus | "all">("all");
  const [clientFilter, setClientFilter] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState<"importance" | "dueDate">("importance");

  // Drawer state
  const [active, setActive] = useState<Project | null>(null);
  const [invLoading, setInvLoading] = useState(false);
  const [invoices, setInvoices] = useState<InvoiceRow[]>([]);

  // Lightweight client profile cache (clientId -> profile)
  const [profiles, setProfiles] = useState<Record<string, ClientProfile>>({});

  // avoid click firing right after a drag ends
  const dragEndedAt = useRef<number>(0);

  useEffect(() => {
    if (!user || role !== "admin") return;

    const q = query(
      collectionGroup(db, "projects"),
      orderBy("status"),
      orderBy("dueDate")
    );

    const unsub = onSnapshot(q, (snap) => {
      const rows: Project[] = [];
      snap.forEach((docSnap) => {
        const data = docSnap.data() as DocumentData;
        const parent = docSnap.ref.parent.parent;
        const clientId = parent?.id;
        const parentPath = parent?.path;

        const dueDate = tsToDateStr(data.dueDate);

        rows.push({
          id: docSnap.id,
          title: data.title || "(untitled)",
          description: data.description || "",
          status: (data.status ?? "new") as ProjectStatus,
          dueDate,
          position: data.position,
          createdAt: data.createdAt ?? null,
          updatedAt: data.updatedAt ?? null,
          priority: data.priority ?? "medium",
          tags: data.tags ?? [],
          assignedTo: data.assignedTo ?? "",
          clientId,
          clientName:
            data.clientName || data.client_name || clientId || "Unknown",
          __parentPath: parentPath,
        });
      });
      setProjects(rows);
    });

    return () => unsub();
  }, [user, role]);

  // Fetch missing client profiles for the clientIds visible in current list
  useEffect(() => {
    const ids = Array.from(
      new Set(projects.map((p) => p.clientId).filter(Boolean) as string[])
    );
    const missing = ids.filter((id) => !profiles[id]);
    if (missing.length === 0) return;

    let canceled = false;
    (async () => {
      const updates: Record<string, ClientProfile> = {};
      for (const id of missing) {
        try {
          const snap = await getDoc(doc(db, "users", id));
          const data = snap.exists() ? (snap.data() as any) : {};
          updates[id] = {
            displayName:
              data.displayName || data.name || data.fullName || data.company,
            email: data.email,
            company: data.company || data.companyName,
            photoURL: data.photoURL || data.avatarUrl || data.logoUrl,
          };
        } catch {
          updates[id] = {};
        }
      }
      if (!canceled) {
        setProfiles((prev) => ({ ...prev, ...updates }));
      }
    })();
    return () => {
      canceled = true;
    };
  }, [projects, profiles, db]);

  // Load invoices when drawer opens (with safe fallback if createdAt is missing)
  useEffect(() => {
    let canceled = false;
    const run = async () => {
      if (!active?.clientId) {
        setInvoices([]);
        return;
      }
      setInvLoading(true);
      try {
        let snap;
        try {
          const cq = query(
            collection(db, `users/${active.clientId}/invoices`),
            orderBy("createdAt", "desc"),
            limit(25)
          );
          snap = await getDocs(cq);
        } catch {
          // Fallback: no orderBy (handles missing field/index)
          const cq = query(
            collection(db, `users/${active.clientId}/invoices`),
            limit(25)
          );
          snap = await getDocs(cq);
        }
        if (canceled) return;
        const rows: InvoiceRow[] = [];
        snap.forEach((d) => {
          const v = d.data() as DocumentData;
          rows.push({
            id: d.id,
            title: v.title || v.number || v.name || `Invoice ${d.id}`,
            amount: typeof v.amount === "number" ? v.amount : Number(v.amount),
            status: v.status,
            dueDate:
              tsToDateStr(v.dueDate) ||
              tsToDateStr(v.due) ||
              tsToDateStr(v.due_on),
            url: v.url || v.link || v.pdfUrl || v.pdfURL,
          });
        });
        setInvoices(rows);
      } catch {
        setInvoices([]);
      } finally {
        if (!canceled) setInvLoading(false);
      }
    };
    run();
    return () => {
      canceled = true;
    };
  }, [active?.clientId]);

  if (!user) {
    return (
      <div className="min-h-[60vh] grid place-items-center px-6">
        <div className="max-w-md w-full rounded-2xl border border-zinc-200 bg-white/80 p-8 text-center shadow-sm dark:border-zinc-800 dark:bg-zinc-900/80">
          <div className="text-2xl font-semibold text-zinc-900 dark:text-zinc-100">
            Please log in
          </div>
          <p className="mt-2 text-zinc-600 dark:text-zinc-400">
            You need an admin account to view this page.
          </p>
        </div>
      </div>
    );
  }
  if (role !== "admin") {
    return (
      <div className="min-h-[60vh] grid place-items-center px-6">
        <div className="max-w-md w-full rounded-2xl border border-zinc-200 bg-white/80 p-8 text-center shadow-sm dark:border-zinc-800 dark:bg-zinc-900/80">
          <div className="text-2xl font-semibold text-zinc-900 dark:text-zinc-100">
            Access denied
          </div>
          <p className="mt-2 text-zinc-600 dark:text-zinc-400">
            Your account does not have permission to view the admin overview.
          </p>
        </div>
      </div>
    );
  }

  // ——— Derived ———
  const clients = useMemo(() => {
    const set = new Set<string>();
    projects.forEach((p) => set.add(p.clientName || p.clientId || "Unknown"));
    return ["all", ...Array.from(set)];
  }, [projects]);

  const filtered = useMemo(() => {
    return projects
      .filter((p) =>
        statusFilter === "all" ? true : p.status === statusFilter
      )
      .filter((p) =>
        clientFilter === "all"
          ? true
          : (p.clientName || p.clientId || "Unknown") === clientFilter
      )
      .filter((p) => {
        if (!search.trim()) return true;
        const hay = (
          p.title +
          " " +
          p.description +
          " " +
          (p.clientName || "")
        ).toLowerCase();
        return hay.includes(search.toLowerCase());
      })
      .sort((a, b) => {
        if (sortBy === "importance") {
          return importanceScore(b) - importanceScore(a);
        } else {
          const aD = a.dueDate ? new Date(a.dueDate).getTime() : Infinity;
          const bD = b.dueDate ? new Date(b.dueDate).getTime() : Infinity;
          return aD - bD;
        }
      });
  }, [projects, statusFilter, clientFilter, search, sortBy]);

  const groupedByStatus = useMemo(() => {
    const buckets: Record<ProjectStatus, Project[]> = {
      new: [],
      "in-progress": [],
      review: [],
      done: [],
    };
    filtered.forEach((p) => buckets[p.status].push(p));
    return buckets;
  }, [filtered]);

  // ——— Badges ———
  const StatusBadge = useCallback(({ s }: { s: ProjectStatus }) => {
    const map: Record<ProjectStatus, string> = {
      new: "bg-zinc-100 text-zinc-700 ring-1 ring-zinc-200 dark:bg-zinc-800 dark:text-zinc-200 dark:ring-zinc-700",
      "in-progress":
        "bg-blue-100/70 text-blue-700 ring-1 ring-blue-200/70 dark:bg-blue-400/10 dark:text-blue-300 dark:ring-blue-400/20",
      review:
        "bg-amber-100/70 text-amber-700 ring-1 ring-amber-200/70 dark:bg-amber-400/10 dark:text-amber-300 dark:ring-amber-400/20",
      done: "bg-emerald-100/70 text-emerald-700 ring-1 ring-emerald-200/70 dark:bg-emerald-400/10 dark:text-emerald-300 dark:ring-emerald-400/20",
    };
    return (
      <span
        className={cn(
          "px-2 py-1 rounded-full text-xs capitalize inline-flex items-center gap-1",
          map[s]
        )}
      >
        <span className="size-1.5 rounded-full bg-current/80"></span>
        {s}
      </span>
    );
  }, []);

  const PriBadge = useCallback(({ p }: { p?: Project["priority"] }) => {
    const map: Record<NonNullable<Project["priority"]>, string> = {
      low: "bg-zinc-100 text-zinc-700 ring-1 ring-zinc-200 dark:bg-zinc-800 dark:text-zinc-200 dark:ring-zinc-700",
      medium:
        "bg-purple-100/70 text-purple-700 ring-1 ring-purple-200/70 dark:bg-purple-400/10 dark:text-purple-300 dark:ring-purple-400/20",
      high:
        "bg-rose-100/70 text-rose-700 ring-1 ring-rose-200/70 dark:bg-rose-400/10 dark:text-rose-300 dark:ring-rose-400/20",
    };
    const key = p ?? "medium";
    return (
      <span className={cn("px-2 py-1 rounded-full text-xs", map[key])}>
        {key}
      </span>
    );
  }, []);

  // ——— Drag-end → Firestore ———
  const handleDragEnd = async (result: DropResult) => {
    dragEndedAt.current = Date.now();
    if (!result.destination) return;

    const { draggableId, source, destination } = result;
    const newStatus = destination.droppableId as ProjectStatus;

    const { clientId, id } = parseDragId(draggableId);
    const proj = projects.find((p) => p.id === id && p.clientId === clientId);
    if (!proj || !proj.clientId) return;
    if (proj.status === newStatus && source.index === destination.index) return;

    // Optimistic UI
    setProjects((prev) =>
      prev.map((p) =>
        p.id === id && p.clientId === clientId ? { ...p, status: newStatus } : p
      )
    );

    try {
      await updateDoc(doc(db, `users/${proj.clientId}/projects/${proj.id}`), {
        status: newStatus,
        updatedAt: serverTimestamp(),
      });
    } catch (err) {
      console.error("Error updating status:", err);
      // Revert on failure
      setProjects((prev) =>
        prev.map((p) =>
          p.id === id && p.clientId === clientId
            ? { ...p, status: proj.status }
            : p
        )
      );
    }
  };

  // ——— Card click → open drawer ———
  const onCardClick = (e: React.MouseEvent, p: Project) => {
    if (Date.now() - dragEndedAt.current < 150) return; // ignore click right after drag
    setActive(p);
  };

  // ——— Open dashboard & hint which client to view (simple, no route changes) ———
  const openDashboardFor = (clientId?: string) => {
    try {
      if (clientId) {
        localStorage.setItem("admin:viewingClientId", clientId);
        const email = clientId ? profiles[clientId]?.email : undefined;
        if (email) localStorage.setItem("admin:viewingEmail", email);
      }
    } catch {
      /* ignore */
    }
    window.open(DASHBOARD_ROUTE, "_blank", "noopener,noreferrer");
  };

  return (
    <div
      className="
      min-h-screen
      bg-[linear-gradient(180deg,#fafafa,transparent_40%),radial-gradient(1200px_400px_at_50%_-50%,rgba(0,0,0,0.06),transparent)]
      dark:bg-[linear-gradient(180deg,#0b0b0b,transparent_40%),radial-gradient(1200px_400px_at_50%_-50%,rgba(255,255,255,0.06),transparent)]
      "
    >
      {/* Top bar */}
      <header className="sticky top-0 z-30 border-b border-zinc-200 bg-white/80 backdrop-blur supports-[backdrop-filter]:bg-white/60 dark:border-zinc-800 dark:bg-zinc-900/70 dark:supports-[backdrop-filter]:bg-zinc-900/60">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            {/* favicon instead of letter icon */}
            <img
              src="/favicon.ico"
              alt="Mogul Design Agency"
              className="size-8 rounded-xl"
            />
            <div>
              <div className="text-sm text-zinc-500 dark:text-zinc-400">
                Mogul Design Agency
              </div>
              <div className="font-semibold text-zinc-900 dark:text-zinc-100">
                Admin Dashboard
              </div>
            </div>
          </div>

          <div className="hidden md:flex items-center gap-2">
            <span className="text-xs text-zinc-500 dark:text-zinc-400">
              Sorted by {sortBy === "importance" ? "Importance" : "Due date"}
            </span>
            <div className="h-6 w-px bg-zinc-200 dark:bg-zinc-800" />
            <div className="rounded-full bg-zinc-100 text-zinc-700 px-3 py-1 text-xs dark:bg-zinc-800 dark:text-zinc-200">
              {filtered.length} items
            </div>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-8 space-y-8">
        {/* Filters / controls */}
        <section className="rounded-2xl border border-zinc-200 bg-white/70 backdrop-blur p-4 sm:p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900/60">
          <div className="flex flex-col lg:flex-row lg:items-end gap-3 justify-between">
            <div>
              <h1 className="text-xl sm:text-2xl font-semibold text-zinc-900 dark:text-zinc-100">
                Overview
              </h1>
              <p className="text-sm text-zinc-500 dark:text-zinc-400">
                All client projects, ranked by{" "}
                {sortBy === "importance" ? "importance" : "due date"}.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <select
                className="h-10 rounded-xl border border-zinc-200 bg-white px-3 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as any)}
              >
                <option value="all">All Statuses</option>
                <option value="new">New</option>
                <option value="in-progress">In Progress</option>
                <option value="review">Review</option>
                <option value="done">Done</option>
              </select>

              <select
                className="h-10 rounded-xl border border-zinc-200 bg-white px-3 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
                value={clientFilter}
                onChange={(e) => setClientFilter(e.target.value)}
              >
                {clients.map((c) => (
                  <option key={c} value={c}>
                    {c === "all" ? "All Clients" : c}
                  </option>
                ))}
              </select>

              <div className="relative">
                <input
                  className="h-10 w-48 sm:w-64 rounded-xl border border-zinc-200 bg-white pl-9 pr-3 text-sm text-zinc-900 placeholder-zinc-400 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:placeholder-zinc-500"
                  placeholder="Search title, description, client…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
                <svg
                  className="absolute left-2 top-1/2 -translate-y-1/2 size-4 text-zinc-400 dark:text-zinc-500"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <circle cx="11" cy="11" r="7" />
                  <path d="m20 20-3.5-3.5" />
                </svg>
              </div>

              <select
                className="h-10 rounded-xl border border-zinc-200 bg-white px-3 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as any)}
              >
                <option value="importance">Sort: Importance</option>
                <option value="dueDate">Sort: Due Date</option>
              </select>

              <div className="inline-flex rounded-xl border border-zinc-200 bg-white overflow-hidden dark:border-zinc-700 dark:bg-zinc-900">
                <button
                  className={cn(
                    "px-3 py-2 text-sm transition",
                    view === "table"
                      ? "bg-zinc-100 dark:bg-zinc-800"
                      : "hover:bg-zinc-50 dark:hover:bg-zinc-800/70"
                  )}
                  onClick={() => setView("table")}
                >
                  Table
                </button>
                <button
                  className={cn(
                    "px-3 py-2 text-sm transition",
                    view === "kanban"
                      ? "bg-zinc-100 dark:bg-zinc-800"
                      : "hover:bg-zinc-50 dark:hover:bg-zinc-800/70"
                  )}
                  onClick={() => setView("kanban")}
                >
                  Kanban
                </button>
              </div>
            </div>
          </div>
        </section>

        {/* Status summary */}
        <section className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {(["new", "in-progress", "review", "done"] as ProjectStatus[]).map(
            (s) => {
              const count = projects.filter((p) => p.status === s).length;
              return (
                <div
                  key={s}
                  className="rounded-2xl border border-zinc-200 bg-white/70 p-4 shadow-sm backdrop-blur dark:border-zinc-800 dark:bg-zinc-900/60"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-zinc-500 capitalize dark:text-zinc-400">
                      {s}
                    </span>
                    <StatusBadge s={s} />
                  </div>
                  <div className="mt-1 text-3xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
                    {count}
                  </div>
                  <div className="mt-2 h-1.5 w-full rounded-full bg-zinc-100 overflow-hidden dark:bg-zinc-800">
                    <div
                      className={cn(
                        "h-full rounded-full transition-all",
                        s === "new" && "bg-zinc-300 dark:bg-zinc-600",
                        s === "in-progress" && "bg-blue-400 dark:bg-blue-500",
                        s === "review" && "bg-amber-400 dark:bg-amber-500",
                        s === "done" && "bg-emerald-400 dark:bg-emerald-500"
                      )}
                      style={{
                        width: `${Math.min(
                          100,
                          (count / Math.max(projects.length, 1)) * 100
                        )}%`,
                      }}
                    />
                  </div>
                </div>
              );
            }
          )}
        </section>

        {/* Main content */}
        {view === "table" ? (
          <section className="overflow-auto rounded-2xl border border-zinc-200 bg-white/70 shadow-sm backdrop-blur dark:border-zinc-800 dark:bg-zinc-900/60">
            <table className="min-w-full text-sm">
              <thead className="bg-zinc-50/70 dark:bg-zinc-900/60">
                <tr className="text-left text-zinc-600 dark:text-zinc-300">
                  <th className="px-4 py-3 font-medium">Project</th>
                  <th className="px-4 py-3 font-medium">Client</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">Priority</th>
                  <th className="px-4 py-3 font-medium">Due</th>
                  <th className="px-4 py-3 font-medium">Score</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((p, i) => {
                  const score = importanceScore(p);
                  const du = daysUntil(p.dueDate);
                  const danger =
                    p.dueDate && (du < 0 || du <= 3)
                      ? "text-rose-600 dark:text-rose-400 font-medium"
                      : "text-zinc-700 dark:text-zinc-300";
                  return (
                    <tr
                      key={`${p.__parentPath}-${p.id}`}
                      className={cn(
                        "border-t border-zinc-200 dark:border-zinc-800",
                        i % 2 === 0
                          ? "bg-white/60 dark:bg-zinc-900/40"
                          : "bg-white/30 dark:bg-zinc-900/20"
                      )}
                    >
                      <td className="px-4 py-3">
                        <div className="font-medium text-zinc-900 dark:text-zinc-100">
                          {p.title}
                        </div>
                        <div className="text-zinc-500 dark:text-zinc-400 line-clamp-2">
                          {p.description}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <ClientBadge
                          p={p}
                          profile={p.clientId ? profiles[p.clientId] : undefined}
                        />
                      </td>
                      <td className="px-4 py-3">
                        <StatusBadge s={p.status} />
                      </td>
                      <td className="px-4 py-3">
                        <PriBadge p={p.priority} />
                      </td>
                      <td className={cn("px-4 py-3", danger)}>
                        {humanDate(p.dueDate)}
                      </td>
                      <td className="px-4 py-3 text-zinc-700 dark:text-zinc-300">
                        {score}
                      </td>
                    </tr>
                  );
                })}
                {filtered.length === 0 && (
                  <tr>
                    <td
                      colSpan={6}
                      className="px-4 py-10 text-center text-zinc-500 dark:text-zinc-400"
                    >
                      No projects match your filters.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </section>
        ) : (
          // ✅ Kanban with DnD + click to open details drawer
          <DragDropContext onDragEnd={handleDragEnd}>
            <section className="grid grid-cols-1 md:grid-cols-4 gap-4">
              {(["new", "in-progress", "review", "done"] as ProjectStatus[]).map(
                (s) => (
                  <Droppable droppableId={s} key={s}>
                    {(dropProvided) => (
                      <div
                        ref={dropProvided.innerRef}
                        {...dropProvided.droppableProps}
                        className="rounded-2xl border border-zinc-200 bg-white/70 p-3 shadow-sm backdrop-blur dark:border-zinc-800 dark:bg-zinc-900/60 overflow-visible min-h-[80px]"
                      >
                        <div className="flex items-center justify-between mb-2">
                          <div className="font-semibold capitalize text-zinc-900 dark:text-zinc-100">
                            {s}
                          </div>
                          <StatusBadge s={s} />
                        </div>

                        <div className="space-y-3">
                          {groupedByStatus[s].map((p, idx) => {
                            const score = importanceScore(p);
                            const du = daysUntil(p.dueDate);
                            const warn = p.dueDate && (du < 0 || du <= 3);
                            const dndId = makeDragId(p);
                            const key = `${p.__parentPath}-${p.id}`;

                            return (
                              <Draggable draggableId={dndId} index={idx} key={key}>
                                {(dragProvided, snapshot) => (
                                  <DraggablePortal isDragging={snapshot.isDragging}>
                                    <div
                                      ref={dragProvided.innerRef}
                                      {...dragProvided.draggableProps}
                                      className={cn(
                                        "rounded-xl border border-zinc-200 bg-white p-3 shadow-[0_1px_0_rgba(0,0,0,0.04)] hover:shadow transition-shadow dark:border-zinc-800 dark:bg-zinc-900 select-none",
                                        "focus:outline-none focus:ring-2 focus:ring-blue-300",
                                        snapshot.isDragging &&
                                          "z-[9999] ring-2 ring-blue-300 scale-[1.01] shadow-lg"
                                      )}
                                      style={{
                                        ...dragProvided.draggableProps.style,
                                      }}
                                    >
                                      <div className="flex items-center gap-2">
                                        {/* Drag handle */}
                                        <button
                                          type="button"
                                          aria-label="Drag"
                                          {...dragProvided.dragHandleProps}
                                          className="shrink-0 p-1 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800 cursor-grab active:cursor-grabbing"
                                          onMouseDown={() => (dragEndedAt.current = 0)}
                                        >
                                          <svg
                                            viewBox="0 0 20 20"
                                            className="size-4 text-zinc-400"
                                            fill="currentColor"
                                          >
                                            <circle cx="6" cy="6" r="1.5" />
                                            <circle cx="6" cy="10" r="1.5" />
                                            <circle cx="6" cy="14" r="1.5" />
                                            <circle cx="10" cy="6" r="1.5" />
                                            <circle cx="10" cy="10" r="1.5" />
                                            <circle cx="10" cy="14" r="1.5" />
                                          </svg>
                                        </button>

                                        <h3
                                          className="text-sm font-semibold leading-tight text-zinc-900 dark:text-zinc-100 cursor-pointer"
                                          onClick={(e) => onCardClick(e, p)}
                                        >
                                          {p.title}
                                        </h3>
                                      </div>

                                      <div
                                        className="mt-1 cursor-pointer"
                                        onClick={(e) => onCardClick(e, p)}
                                      >
                                        <ClientBadge
                                          p={p}
                                          profile={
                                            p.clientId
                                              ? profiles[p.clientId]
                                              : undefined
                                          }
                                        />
                                      </div>

                                      <p
                                        className="mt-2 text-xs text-zinc-600 dark:text-zinc-300 line-clamp-3 cursor-pointer"
                                        onClick={(e) => onCardClick(e, p)}
                                      >
                                        {p.description}
                                      </p>

                                      <div className="mt-3 flex items-center gap-2 text-[11px]">
                                        <PriBadge p={p.priority} />
                                        <span
                                          className={cn(
                                            "px-2 py-0.5 rounded-full ring-1",
                                            warn
                                              ? "text-rose-700 ring-rose-200 bg-rose-50 dark:text-rose-300 dark:ring-rose-900/40 dark:bg-rose-900/20"
                                              : "text-zinc-600 ring-zinc-200 bg-zinc-50 dark:text-zinc-300 dark:ring-zinc-700 dark:bg-zinc-800/60"
                                          )}
                                        >
                                          Due: {humanDate(p.dueDate)}
                                        </span>
                                        <span className="ml-auto text-zinc-500 dark:text-zinc-400">
                                          Score: {score}
                                        </span>
                                      </div>
                                    </div>
                                  </DraggablePortal>
                                )}
                              </Draggable>
                            );
                          })}
                          {dropProvided.placeholder}
                        </div>
                      </div>
                    )}
                  </Droppable>
                )
              )}
            </section>
          </DragDropContext>
        )}
      </main>

      {/* ——— Project Details Drawer ——— */}
      <div
        className={cn(
          "fixed inset-0 z-[10000] transition",
          active ? "pointer-events-auto" : "pointer-events-none"
        )}
        aria-hidden={!active}
      >
        {/* Backdrop */}
        <div
          className={cn(
            "absolute inset-0 bg-black/30 backdrop-blur-sm transition-opacity",
            active ? "opacity-100" : "opacity-0"
          )}
          onClick={() => setActive(null)}
        />
        {/* Panel */}
        <aside
          className={cn(
            "absolute right-0 top-0 h-full w-full max-w-md shadow-xl border-l border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 transition-transform",
            active ? "translate-x-0" : "translate-x-full"
          )}
          role="dialog"
          aria-modal="true"
        >
          <div className="h-16 px-4 flex items-center justify-between border-b border-zinc-200 dark:border-zinc-800">
            <div className="font-semibold text-zinc-900 dark:text-zinc-100">
              {active?.title || "Project"}
            </div>
            <button
              className="rounded-lg p-2 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
              onClick={() => setActive(null)}
              aria-label="Close"
            >
              ✕
            </button>
          </div>

          <div className="p-4 space-y-4 overflow-y-auto h-[calc(100%-4rem)]">
            {/* Client */}
            <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 p-3 bg-white/70 dark:bg-zinc-900/60">
              <div className="text-xs uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                Client
              </div>

              <div className="mt-1">
                {active ? (
                  <ClientBadge
                    p={active}
                    profile={
                      active.clientId ? profiles[active.clientId] : undefined
                    }
                  />
                ) : (
                  <span className="text-sm text-zinc-500">—</span>
                )}
              </div>

              <div className="mt-2 flex gap-2">
                <button
                  className="rounded-lg border border-zinc-200 dark:border-zinc-700 px-3 py-1.5 text-xs hover:bg-zinc-50 dark:hover:bg-zinc-800"
                  onClick={() => openDashboardFor(active?.clientId)}
                >
                  Open Dashboard
                </button>
                {active?.clientId && (
                  <button
                    className="rounded-lg border border-zinc-200 dark:border-zinc-700 px-3 py-1.5 text-xs hover:bg-zinc-50 dark:hover:bg-zinc-800"
                    onClick={() =>
                      navigator.clipboard.writeText(active.clientId!)
                    }
                  >
                    Copy Client ID
                  </button>
                )}
              </div>
            </div>

            {/* Status / priority / due */}
            <div className="grid grid-cols-3 gap-2">
              <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 p-3 bg-white/70 dark:bg-zinc-900/60">
                <div className="text-xs text-zinc-500 dark:text-zinc-400">
                  Status
                </div>
                {active && (
                  <div className="mt-1">
                    <StatusBadge s={active.status} />
                  </div>
                )}
              </div>
              <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 p-3 bg-white/70 dark:bg-zinc-900/60">
                <div className="text-xs text-zinc-500 dark:text-zinc-400">
                  Priority
                </div>
                {active && (
                  <div className="mt-1">
                    <PriBadge p={active.priority} />
                  </div>
                )}
              </div>
              <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 p-3 bg-white/70 dark:bg-zinc-900/60">
                <div className="text-xs text-zinc-500 dark:text-zinc-400">
                  Due
                </div>
                <div className="mt-1 text-sm text-zinc-900 dark:text-zinc-100">
                  {humanDate(active?.dueDate)}
                </div>
              </div>
            </div>

            {/* Assigned / tags */}
            <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 p-3 bg-white/70 dark:bg-zinc-900/60">
              <div className="text-xs text-zinc-500 dark:text-zinc-400">
                Assigned
              </div>
              <div className="mt-1 text-sm text-zinc-900 dark:text-zinc-100">
                {active?.assignedTo || "—"}
              </div>
              <div className="mt-3 text-xs text-zinc-500 dark:text-zinc-400">
                Tags
              </div>
              <div className="mt-1 flex flex-wrap gap-1">
                {(active?.tags || []).length ? (
                  active!.tags!.map((t) => (
                    <span
                      key={t}
                      className="px-2 py-1 rounded-full text-[11px] bg-zinc-100 text-zinc-700 ring-1 ring-zinc-200 dark:bg-zinc-800 dark:text-zinc-200 dark:ring-zinc-700"
                    >
                      {t}
                    </span>
                  ))
                ) : (
                  <span className="text-sm text-zinc-400">—</span>
                )}
              </div>
            </div>

            {/* Description */}
            <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 p-3 bg-white/70 dark:bg-zinc-900/60">
              <div className="text-xs text-zinc-500 dark:text-zinc-400">
                Description
              </div>
              <p className="mt-1 text-sm text-zinc-800 dark:text-zinc-200 whitespace-pre-wrap">
                {active?.description || "—"}
              </p>
            </div>

            {/* Invoices */}
            <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 p-3 bg-white/70 dark:bg-zinc-900/60">
              <div className="flex items-center justify-between">
                <div className="text-xs uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                  Invoices {active?.clientId ? "" : "(no client id)"}
                </div>
                {invLoading && (
                  <div className="text-xs text-zinc-400">Loading…</div>
                )}
              </div>

              {!active?.clientId ? (
                <div className="mt-2 text-sm text-zinc-500">
                  No client id on this project.
                </div>
              ) : invoices.length === 0 && !invLoading ? (
                <div className="mt-2 text-sm text-zinc-500">
                  No invoices found.
                </div>
              ) : (
                <ul className="mt-2 space-y-2">
                  {invoices.map((inv) => (
                    <li
                      key={inv.id}
                      className="rounded-lg border border-zinc-200 dark:border-zinc-800 p-2 flex items-center justify-between"
                    >
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium text-zinc-900 dark:text-zinc-100">
                          {inv.title || inv.id}
                        </div>
                        <div className="text-xs text-zinc-500 dark:text-zinc-400">
                          {inv.status || "—"} · Due {humanDate(inv.dueDate)}
                        </div>
                      </div>
                      <div className="ml-3 flex items-center gap-2 shrink-0">
                        {typeof inv.amount === "number" &&
                          !Number.isNaN(inv.amount) && (
                            <span className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                              $
                              {inv.amount.toLocaleString(undefined, {
                                minimumFractionDigits: 2,
                                maximumFractionDigits: 2,
                              })}
                            </span>
                          )}
                        {inv.url && (
                          <a
                            href={inv.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-xs px-2 py-1 rounded border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-800"
                          >
                            Open
                          </a>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* Timestamps */}
            <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 p-3 bg-white/70 dark:bg-zinc-900/60">
              <div className="grid grid-cols-2 gap-2 text-xs text-zinc-500 dark:text-zinc-400">
                <div>
                  <div>Created</div>
                  <div className="mt-1 text-zinc-900 dark:text-zinc-100 text-sm">
                    {active?.createdAt?.toDate
                      ? active.createdAt.toDate().toLocaleString()
                      : "—"}
                  </div>
                </div>
                <div>
                  <div>Updated</div>
                  <div className="mt-1 text-zinc-900 dark:text-zinc-100 text-sm">
                    {active?.updatedAt?.toDate
                      ? active.updatedAt.toDate().toLocaleString()
                      : "—"}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
