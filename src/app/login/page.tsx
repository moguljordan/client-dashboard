"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useRouter } from "next/navigation";
import Image from "next/image"; // ✅ Next.js optimized images

export default function LoginPage() {
  const { user, loginWithGoogle } = useAuth();
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

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

  return (
    <div className="min-h-screen bg-black text-white flex items-center justify-center p-4">
      <div className="bg-neutral-950 rounded-xl border border-neutral-800 w-full max-w-md p-8 shadow-2xl">
        
        {/* Logo replaces Lucide icon */}
        <div className="flex justify-center mb-6">
          <Image
            src="/logo.png"   // ✅ Your main logo in /public
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
          <div className="bg-neutral-900 border border-red-700 rounded-lg p-3 mb-6">
            <p className="text-red-400 text-sm">{error}</p>
          </div>
        )}

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
                src="/google-icon.svg"  // ✅ must be in /public
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
