"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { auth, db } from "@/lib/firebase";
import {
  updateProfile,
  updateEmail,
  updatePassword,
  sendPasswordResetEmail,
  deleteUser,
} from "firebase/auth";
import {
  doc,
  getDoc,
  setDoc,
  serverTimestamp,
} from "firebase/firestore";

export default function SettingsPage() {
  const { user } = useAuth();

  const [displayName, setDisplayName] = useState(user?.displayName || "");
  const [phone, setPhone] = useState("");
  const [jobTitle, setJobTitle] = useState("");
  const [address, setAddress] = useState("");
  const [email, setEmail] = useState(user?.email || "");
  const [password, setPassword] = useState("");

  const [status, setStatus] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    async function loadProfile() {
      if (!user) return;
      const ref = doc(db, "users", user.uid);
      const snap = await getDoc(ref);
      if (snap.exists()) {
        const data = snap.data();
        setPhone(data.phone || "");
        setJobTitle(data.jobTitle || "");
        setAddress(data.address || "");
        if (data.displayName) setDisplayName(data.displayName);
      }
    }
    loadProfile();
  }, [user]);

  if (!user) {
    return <div className="p-6 text-gray-400 bg-black min-h-screen">Please log in to view settings.</div>;
  }

  async function handleSaveChanges() {
    try {
      setLoading(true);
      await updateProfile(user, { displayName });
      if (email && email !== user.email) await updateEmail(user, email);
      if (password.length >= 6) {
        await updatePassword(user, password);
        setPassword("");
      }
      const ref = doc(db, "users", user.uid);
      await setDoc(ref, { displayName, phone, jobTitle, address, email, updatedAt: serverTimestamp() }, { merge: true });
      setStatus("Changes saved successfully.");
    } catch (err: any) {
      setStatus("Error: " + err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleResetPassword() {
    try {
      setLoading(true);
      await sendPasswordResetEmail(auth, user.email!);
      setStatus("Password reset email sent.");
    } catch (err: any) {
      setStatus("Error: " + err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleDeleteAccount() {
    if (!confirm("Are you sure you want to delete your account? This cannot be undone.")) return;
    try {
      setLoading(true);
      await deleteUser(user);
      await setDoc(doc(db, "users", user.uid), { deletedAt: serverTimestamp() }, { merge: true });
      setStatus("Account deleted.");
    } catch (err: any) {
      setStatus("Error: " + err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="p-6 bg-black min-h-screen text-white">
      <h1 className="text-2xl font-bold mb-6">My Account</h1>

      {status && (
        <div className="mb-4 p-3 rounded border text-sm bg-neutral-900 border-neutral-700 text-gray-300">
          {status}
        </div>
      )}

      <div className="space-y-6 max-w-lg">
        {/* Profile + Account Form */}
        <div className="bg-neutral-950 border border-neutral-800 rounded-lg p-4 shadow-sm">
          <h2 className="text-lg font-semibold mb-3">Profile</h2>

          <label className="block text-sm text-gray-400 mb-1">Name</label>
          <input
            type="text"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            className="w-full bg-black text-white border border-neutral-700 rounded px-3 py-2 mb-3"
          />

          <label className="block text-sm text-gray-400 mb-1">Phone</label>
          <input
            type="text"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            className="w-full bg-black text-white border border-neutral-700 rounded px-3 py-2 mb-3"
          />

          <label className="block text-sm text-gray-400 mb-1">Job Title</label>
          <input
            type="text"
            value={jobTitle}
            onChange={(e) => setJobTitle(e.target.value)}
            className="w-full bg-black text-white border border-neutral-700 rounded px-3 py-2 mb-3"
          />

          <label className="block text-sm text-gray-400 mb-1">Address</label>
          <textarea
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            className="w-full bg-black text-white border border-neutral-700 rounded px-3 py-2 mb-3"
          />

          <label className="block text-sm text-gray-400 mb-1">Email</label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full bg-black text-white border border-neutral-700 rounded px-3 py-2 mb-3"
          />

          <label className="block text-sm text-gray-400 mb-1">New Password</label>
          <input
            type="password"
            placeholder="Leave blank to keep current"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full bg-black text-white border border-neutral-700 rounded px-3 py-2 mb-3"
          />

          <div className="flex justify-between">
            <button
              onClick={handleResetPassword}
              disabled={loading}
              className="bg-neutral-800 text-gray-200 px-4 py-2 rounded hover:bg-neutral-700 text-sm"
            >
              Send Password Reset Email
            </button>
            <button
              onClick={handleSaveChanges}
              disabled={loading}
              className="bg-white text-black px-4 py-2 rounded hover:bg-gray-200"
            >
              {loading ? "Saving..." : "Save Changes"}
            </button>
          </div>
        </div>

        {/* Account Actions */}
        <div className="bg-neutral-950 border border-red-700 rounded-lg p-4 shadow-sm">
          <h2 className="text-lg font-semibold mb-3 text-red-500">Account</h2>
          <button
            onClick={handleDeleteAccount}
            disabled={loading}
            className="bg-red-600 text-white px-4 py-2 rounded hover:bg-red-700"
          >
            Delete Account
          </button>
        </div>
      </div>
    </div>
  );
}
