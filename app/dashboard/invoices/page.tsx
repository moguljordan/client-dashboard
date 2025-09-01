"use client";

import { useEffect, useState } from "react";
import { collection, onSnapshot, orderBy, query } from "firebase/firestore";
import { auth, db } from "@/lib/firebase";

type Invoice = {
  id: string;
  status?: string | null;
  amount_due?: number | null;
  amount_paid?: number | null;
  currency?: string | null;
  hosted_invoice_url?: string | null;
  pdf?: string | null;
  created?: { seconds: number; nanoseconds: number } | Date | null;
  number?: string | null;
  userId?: string; // added if admin viewing
};

function fmtAmount(cents?: number | null, currency?: string | null) {
  if (cents == null) return "-";
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: (currency || "usd").toUpperCase(),
  }).format(cents / 100);
}

export default function InvoicesPage() {
  const [rows, setRows] = useState<Invoice[]>([]);
  const [status, setStatus] = useState("Loading…");

  useEffect(() => {
    let unsub: (() => void) | undefined;

    const run = async () => {
      const user = auth.currentUser;
      if (!user) {
        setStatus("Please sign in");
        return;
      }

      // Get ID token claims to check if admin
      const token = await user.getIdTokenResult();
      const isAdmin = !!token.claims.admin;

      if (!isAdmin) {
        // 🔹 Normal user → ensure customer + listen to their invoices
        await fetch("/api/stripe/ensure-customer", {
          method: "POST",
          headers: { Authorization: `Bearer ${token.token}` },
        });

        const col = collection(db, "users", user.uid, "invoices");
        const q = query(col, orderBy("created", "desc"));
        unsub = onSnapshot(q, (snap) => {
          const items = snap.docs
            .map((d) => ({ id: d.id, ...d.data() } as Invoice))
            .filter((inv) => inv.status !== "void" && inv.status !== "draft"); // filter
          setRows(items);
          setStatus(items.length ? "" : "No invoices yet");
        });
      } else {
        // 🔹 Admin → listen to all invoices under all users
        const usersCol = collection(db, "users");
        unsub = onSnapshot(usersCol, (usersSnap) => {
          let allInvoices: Invoice[] = [];
          usersSnap.forEach((userDoc) => {
            const invCol = collection(db, "users", userDoc.id, "invoices");
            const q = query(invCol, orderBy("created", "desc"));
            onSnapshot(q, (invSnap) => {
              const invoices = invSnap.docs
                .map(
                  (d) =>
                    ({
                      id: d.id,
                      userId: userDoc.id,
                      ...d.data(),
                    } as Invoice)
                )
                .filter((inv) => inv.status !== "void" && inv.status !== "draft"); // filter

              allInvoices = [...allInvoices, ...invoices];
              setRows([...allInvoices].sort((a, b) => {
                const aTime =
                  a.created instanceof Date
                    ? a.created.getTime()
                    : (a.created as any)?.seconds * 1000 || 0;
                const bTime =
                  b.created instanceof Date
                    ? b.created.getTime()
                    : (b.created as any)?.seconds * 1000 || 0;
                return bTime - aTime;
              }));
              setStatus(allInvoices.length ? "" : "No invoices yet");
            });
          });
        });
      }
    };

    run();
    return () => {
      if (unsub) unsub();
    };
  }, []);

  return (
    <div className="p-6 bg-white text-black min-h-screen">
      <h1 className="text-2xl font-bold mb-4">Invoices</h1>
      {status && <div className="mb-4 text-sm text-gray-600">{status}</div>}
      <div className="overflow-x-auto border rounded shadow-sm">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-100 text-gray-700">
            <tr>
              <th className="p-3 text-left font-medium">Number</th>
              <th className="p-3 text-left font-medium">Status</th>
              <th className="p-3 text-right font-medium">Amount Due</th>
              <th className="p-3 text-right font-medium">Amount Paid</th>
              <th className="p-3 text-left font-medium">Links</th>
              <th className="p-3 text-left font-medium">Created</th>
              <th className="p-3 text-left font-medium">User</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {rows.map((inv) => (
              <tr key={inv.id} className="hover:bg-gray-50">
                <td className="p-3">{inv.number || inv.id}</td>
                <td className="p-3 capitalize">{inv.status}</td>
                <td className="p-3 text-right">{fmtAmount(inv.amount_due, inv.currency)}</td>
                <td className="p-3 text-right">{fmtAmount(inv.amount_paid, inv.currency)}</td>
                <td className="p-3">
                  {inv.hosted_invoice_url && (
                    <a
                      className="text-blue-600 underline mr-3"
                      href={inv.hosted_invoice_url}
                      target="_blank"
                    >
                      View
                    </a>
                  )}
                  {inv.pdf && (
                    <a
                      className="text-blue-600 underline"
                      href={inv.pdf}
                      target="_blank"
                    >
                      PDF
                    </a>
                  )}
                </td>
                <td className="p-3">
                  {(() => {
                    const d =
                      inv.created instanceof Date
                        ? inv.created
                        : inv.created && "seconds" in (inv.created as any)
                        ? new Date((inv.created as any).seconds * 1000)
                        : null;
                    return d ? d.toLocaleString() : "-";
                  })()}
                </td>
                <td className="p-3">{inv.userId || "-"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
