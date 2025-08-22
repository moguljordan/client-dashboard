// /app/admin/page.tsx
"use client";

import { useAuth } from "@/contexts/AuthContext";
import { db } from "@/lib/firebase";
import { collection, getDocs } from "firebase/firestore";
import { useEffect, useState } from "react";
import Link from "next/link";

export default function AdminPage() {
  const { user, role } = useAuth();
  const [clients, setClients] = useState<any[]>([]);

  useEffect(() => {
    if (role === "admin") {
      getDocs(collection(db, "users")).then((snap) => {
        setClients(snap.docs.map((doc) => ({ id: doc.id, ...doc.data() })));
      });
    }
  }, [role]);

  if (!user) return <div>Please log in</div>;
  if (role !== "admin") return <div>Access denied</div>;

  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold mb-4">Admin Panel</h1>
      <ul className="space-y-2">
        {clients.map((c) => (
          <li key={c.id} className="border p-2 rounded">
            <Link href={`/admin/dashboard/${c.id}`} className="text-blue-600 underline">
              {c.email || c.id}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
