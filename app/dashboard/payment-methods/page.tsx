'use client';

import { useState, useEffect } from 'react';
import { db, auth } from '@/lib/firebase';
import {
  collection,
  query,
  onSnapshot,
  addDoc,
  deleteDoc,
  doc,
  serverTimestamp,
} from 'firebase/firestore';
import { CreditCard, Trash2 } from 'lucide-react';

type PaymentMethod = {
  id: string;
  brand: string;
  last4: string;
  exp_month: number;
  exp_year: number;
  createdAt?: any;
};

export default function PaymentMethodsPage() {
  const [methods, setMethods] = useState<PaymentMethod[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!auth.currentUser) return;
    const q = query(
      collection(db, 'users', auth.currentUser.uid, 'paymentMethods')
    );
    const unsub = onSnapshot(q, (snap) => {
      setMethods(
        snap.docs.map((d) => ({ id: d.id, ...d.data() } as PaymentMethod))
      );
      setLoading(false);
    });
    return () => unsub();
  }, []);

  const addTestMethod = async () => {
    if (!auth.currentUser) return;
    await addDoc(
      collection(db, 'users', auth.currentUser.uid, 'paymentMethods'),
      {
        brand: 'Visa',
        last4: String(Math.floor(1000 + Math.random() * 9000)),
        exp_month: 12,
        exp_year: 2030,
        createdAt: serverTimestamp(),
      }
    );
  };

  const deleteMethod = async (id: string) => {
    if (!auth.currentUser) return;
    await deleteDoc(
      doc(db, 'users', auth.currentUser.uid, 'paymentMethods', id)
    );
  };

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-xl font-semibold flex items-center gap-2">
        <CreditCard className="w-5 h-5" />
        Payment Methods
      </h1>

      {loading ? (
        <p className="text-neutral-400">Loading...</p>
      ) : methods.length === 0 ? (
        <p className="text-neutral-400">No payment methods yet.</p>
      ) : (
        <ul className="space-y-2">
          {methods.map((m) => (
            <li
              key={m.id}
              className="flex items-center justify-between bg-neutral-900 px-4 py-2 rounded-lg"
            >
              <div>
                <p className="font-medium">
                  {m.brand} ending in {m.last4}
                </p>
                <p className="text-xs text-neutral-400">
                  Expires {m.exp_month}/{m.exp_year}
                </p>
              </div>
              <button
                onClick={() => deleteMethod(m.id)}
                className="text-red-400 hover:text-red-300"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </li>
          ))}
        </ul>
      )}

      <button
        onClick={addTestMethod}
        className="bg-white text-black px-4 py-2 rounded-lg font-medium hover:bg-neutral-200"
      >
        + Add Test Card
      </button>
    </div>
  );
}
