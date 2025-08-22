"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { signInWithEmailAndPassword, sendPasswordResetEmail } from "firebase/auth";
import { auth } from "@/lib/firebase";

export default function LoginPage() {
  const { user, loginWithGoogle } = useAuth();
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // Email/password state
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [resetMessage, setResetMessage] = useState("");

  useEffect(() => {
    if (user) {
      router.push("/dashboard");
    }
  }, [user, router]);

  const handleGoogleLogin = async () => {
    try {
      setError("");
      setLoading(true);
      await loginWithGoogle();
      router.push("/dashboard");
    } catch (err: any) {
      setError(err.message || "Google login failed");
    } finally {
      setLoading(false);
    }
  };

  const handleEmailLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setError("");
      setLoading(true);
      await signInWithEmailAndPassword(auth, email, password);
      router.push("/dashboard");
    } catch (err: any) {
      setError(err.message || "Email login failed");
    } finally {
      setLoading(false);
    }
  };

  const handlePasswordReset = async () => {
    if (!email) {
      setError("Enter your email to reset password");
      return;
    }
    try {
      setError("");
      setResetMessage("");
      await sendPasswordResetEmail(auth, email);
      setResetMessage("Password reset email sent!");
    } catch (err: any) {
      setError(err.message || "Failed to send reset email");
    }
  };

  return (
    <div className="min-h-screen bg-black text-white flex items-center justify-center p-4">
      <div className="bg-neutral-950 rounded-xl border border-neutral-800 w-full max-w-md p-8 shadow-2xl">
        
        {/* Logo */}
        <div className="flex justify-center mb-6">
          <Image
            src="/logo.png"
            alt="App Logo"
            width={100}
            height={100}
            priority
            className="rounded-lg"
          />
        </div>

        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold mb-2">Welcome</h1>
          <p className="text-neutral-400">Sign in to your dashboard</p>
        </div>

        {/* Error Message */}
        {error && (
          <div className="bg-neutral-900 border border-red-700 rounded-lg p-3 mb-4">
            <p className="text-red-400 text-sm">{error}</p>
          </div>
        )}

        {/* Reset Message */}
        {resetMessage && (
          <div className="bg-neutral-900 border border-green-700 rounded-lg p-3 mb-4">
            <p className="text-green-400 text-sm">{resetMessage}</p>
          </div>
        )}

        {/* Email + Password Login */}
        <form onSubmit={handleEmailLogin} className="space-y-4 mb-4">
          <input
            type="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full p-3 rounded-lg bg-neutral-900 border border-neutral-700 text-white placeholder-neutral-500 focus:outline-none focus:ring-2 focus:ring-[#FFB906]"
            required
          />
          <input
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full p-3 rounded-lg bg-neutral-900 border border-neutral-700 text-white placeholder-neutral-500 focus:outline-none focus:ring-2 focus:ring-[#FFB906]"
            required
          />
          <button
            type="submit"
            disabled={loading}
            className="w-full bg-[#FFB906] text-black font-medium py-3 px-4 rounded-lg hover:bg-[#e6a800] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? "Processing..." : "Login with Email"}
          </button>
        </form>

        {/* Forgot Password */}
        <div className="text-right mb-6">
          <button
            type="button"
            onClick={handlePasswordReset}
            className="text-sm text-[#FFB906] hover:underline"
          >
            Forgot password?
          </button>
        </div>

        {/* Divider */}
        <div className="flex items-center my-6">
          <div className="flex-grow h-px bg-neutral-800" />
          <span className="px-3 text-neutral-500 text-sm">OR</span>
          <div className="flex-grow h-px bg-neutral-800" />
        </div>

        {/* Google Sign-In Button */}
        <button
          onClick={handleGoogleLogin}
          disabled={loading}
          className="w-full bg-white text-black font-medium py-3 px-4 rounded-lg hover:bg-neutral-200 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
        >
          {loading ? (
            <>
              <div className="w-4 h-4 border-2 border-black/30 border-t-black rounded-full animate-spin" />
              Processing...
            </>
          ) : (
            <>
              <Image
                src="/google-icon.svg"
                alt="Google"
                width={20}
                height={20}
              />
              Continue with Google
            </>
          )}
        </button>
      </div>
    </div>
  );
}
