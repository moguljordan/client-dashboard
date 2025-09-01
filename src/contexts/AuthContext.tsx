// /contexts/AuthContext.tsx
"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";
import {
  User,
  onAuthStateChanged,
  signOut,
  GoogleAuthProvider,
  signInWithPopup,
} from "firebase/auth";
import { auth, db } from "@/lib/firebase";
import { doc, getDoc, setDoc, serverTimestamp } from "firebase/firestore";

interface AuthContextType {
  user: User | null;
  role: string | null;
  isAdmin: boolean;
  loading: boolean;
  loginWithGoogle: () => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({} as AuthContextType);

export const useAuth = () => useContext(AuthContext);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [role, setRole] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      if (firebaseUser) {
        setUser(firebaseUser);

        // Ensure Firestore user doc exists and fetch role
        const userRef = doc(db, "users", firebaseUser.uid);
        const snap = await getDoc(userRef);

        if (!snap.exists()) {
          await setDoc(userRef, {
            email: firebaseUser.email,
            role: "client",
            createdAt: serverTimestamp(),
          });
          setRole("client");
        } else {
          setRole((snap.data() as any).role || "client");
        }
      } else {
        setUser(null);
        setRole(null);
      }

      setLoading(false);
    });

    return unsubscribe;
  }, []);

  const loginWithGoogle = async () => {
    const provider = new GoogleAuthProvider();
    await signInWithPopup(auth, provider);
  };

  const logout = async () => {
    await signOut(auth);
  };

  const isAdmin = role === "admin";
  const value = useMemo<AuthContextType>(
    () => ({ user, role, isAdmin, loading, loginWithGoogle, logout }),
    [user, role, isAdmin, loading]
  );

  return <AuthContext.Provider value={value}>{!loading && children}</AuthContext.Provider>;
}
