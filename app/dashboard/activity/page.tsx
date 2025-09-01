'use client';

import { useState, useEffect } from 'react';
import { db } from '@/lib/firebase';
import {
  collection,
  collectionGroup,
  query,
  orderBy,
  onSnapshot,
  Timestamp,
} from 'firebase/firestore';
import { useAuth } from '@/contexts/AuthContext';
import { Activity } from 'lucide-react';

type ActivityEvent = {
  id: string;
  uid?: string;
  type: 'comment' | 'task' | 'status';
  projectId?: string;
  payload?: any;
  createdAt?: Timestamp | null;
};

export default function ActivityPage() {
  const { user, role } = useAuth() as { user: any; role?: string };
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;

    let q;
    if (role === 'admin') {
      // 🔑 Admin: see all activity across all users
      q = query(collectionGroup(db, 'activity'), orderBy('createdAt', 'desc'));
    } else {
      // 🔑 Client/staff: only see their own activity
      q = query(
        collection(db, 'users', user.uid, 'activity'),
        orderBy('createdAt', 'desc')
      );
    }

    const unsub = onSnapshot(q, (snap) => {
      setEvents(snap.docs.map((d) => ({ id: d.id, ...d.data() } as ActivityEvent)));
      setLoading(false);
    });

    return () => unsub();
  }, [user, role]);

  const formatDate = (ts?: Timestamp | null) => {
    if (!ts) return '';
    return ts.toDate().toLocaleString();
  };

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-xl font-semibold flex items-center gap-2">
        <Activity className="w-5 h-5" />
        Recent Activity
      </h1>

      {loading ? (
        <p className="text-neutral-400">Loading...</p>
      ) : events.length === 0 ? (
        <p className="text-neutral-400">No activity yet.</p>
      ) : (
        <ul className="space-y-2">
          {events.map((e) => (
            <li
              key={e.id}
              className="bg-neutral-900 px-4 py-2 rounded-lg text-sm"
            >
              <p className="font-medium capitalize">{e.type}</p>
              {e.payload && (
                <pre className="text-xs text-neutral-400 mt-1">
                  {JSON.stringify(e.payload, null, 2)}
                </pre>
              )}
              <p className="text-xs text-neutral-500 mt-1">
                {formatDate(e.createdAt)}
                {role === 'admin' && e.uid ? ` · User: ${e.uid}` : ''}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
