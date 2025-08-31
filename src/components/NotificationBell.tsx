"use client";
import { useEffect, useMemo, useState, useCallback } from "react";
import { db } from "@/lib/firebase";
import { useAuth } from "@/contexts/AuthContext";
import {
  collection, query, orderBy, onSnapshot,
  updateDoc, doc, Timestamp
} from "firebase/firestore";

type Noti = {
  id: string;
  type: "comment" | "status" | "due-soon" | "link" | "project" | string;
  title: string;
  body?: string;
  projectId?: string;
  createdAt?: Timestamp | null;
  read: boolean;
  link?: string;
};

export default function NotificationBell() {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Noti[]>([]);

  const notiCol = useMemo(() => {
    if (!user) return null;
    return collection(db, "users", user.uid, "notifications");
  }, [user]);

  useEffect(() => {
    if (!notiCol) return;
    const qy = query(notiCol, orderBy("createdAt", "desc"));
    const unsub = onSnapshot(qy, (snap) => {
      const list: Noti[] = [];
      snap.forEach((d) => list.push({ id: d.id, ...(d.data() as Omit<Noti, "id">) }));
      setItems(list);
    });
    return () => unsub();
  }, [notiCol]);

  const unread = items.filter(i => !i.read).length;
  const display = unread > 99 ? "99+" : String(unread);
  const hasUnread = unread > 0;

  const markAllRead = useCallback(async () => {
    if (!notiCol) return;
    const unreadItems = items.filter(i => !i.read);
    await Promise.all(unreadItems.map(i => updateDoc(doc(notiCol, i.id), { read: true })));
  }, [items, notiCol]);

  const openPanel = useCallback(() => {
    setOpen((v) => !v);
    // optimistically mark read on open
    if (!open) { markAllRead().catch(() => {}); }
  }, [open, markAllRead]);

  return (
    <div className="relative">
      <button
        onClick={openPanel}
        className="relative rounded-lg border border-gray-300 bg-white px-2 py-2 text-sm hover:bg-gray-50 min-w-[40px]"
        title="Notifications"
        aria-label="Notifications"
      >
        <span
          className={`inline-flex items-center justify-center rounded-md px-2 py-1 text-xs font-semibold min-w-[28px]
          ${hasUnread ? "bg-orange-600 text-white" : "bg-gray-200 text-gray-700"}`}
        >
          {display}
        </span>
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-[360px] max-h-[70vh] overflow-auto
                        rounded-xl border border-gray-200 bg-white shadow-xl z-50">
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
            <p className="text-sm font-medium text-gray-800">Notifications</p>
            <button
              onClick={markAllRead}
              className="text-xs text-gray-500 hover:text-gray-700"
            >
              Mark all as read
            </button>
          </div>

          <ul className="divide-y divide-gray-100">
            {items.length === 0 ? (
              <li className="px-4 py-6 text-sm text-gray-500 text-center">No notifications</li>
            ) : items.map((n) => (
              <li key={n.id} className="px-4 py-3 hover:bg-gray-50">
                <a
                  href={n.link || "#"}
                  className="block"
                  onClick={(e) => {
                    if (!n.link) e.preventDefault();
                  }}
                >
                  <div className="flex items-start gap-2">
                    <div className="min-w-0">
                      <p className={`text-sm ${n.read ? "text-gray-700" : "text-gray-900 font-medium"}`}>
                        {n.title}
                      </p>
                      {n.body && (
                        <p className="text-xs text-gray-500 mt-0.5 line-clamp-2">{n.body}</p>
                      )}
                      {n.createdAt?.toDate && (
                        <p className="text-[11px] text-gray-400 mt-1">
                          {n.createdAt.toDate().toLocaleString()}
                        </p>
                      )}
                    </div>
                  </div>
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
