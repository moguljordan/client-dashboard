import { NextRequest, NextResponse } from "next/server";
import { getAuth } from "firebase-admin/auth";
import { adminDb } from "@/lib/firebaseAdmin";
import { stripe } from "@/lib/stripe";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const idToken = req.headers.get("authorization")?.replace("Bearer ", "");
    if (!idToken) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const decoded = await getAuth().verifyIdToken(idToken);
    const uid = decoded.uid;
    const email = decoded.email || undefined;

    const userRef = adminDb.collection("users").doc(uid);
    const snap = await userRef.get();
    const user = snap.data() || {};
    let stripeCustomerId: string | undefined = user.stripeCustomerId;

    // store email for mapping fallback
    if (email && user.email !== email) {
      await userRef.set({ email }, { merge: true });
    }

    if (!stripeCustomerId) {
      // create a customer only if missing
      const customer = await stripe.customers.create({
        email,
        metadata: { firebaseUid: uid },
      });
      stripeCustomerId = customer.id;
      await userRef.set({ stripeCustomerId }, { merge: true });
    }

    return NextResponse.json({ stripeCustomerId });
  } catch (e: any) {
    console.error("ensure-customer error", e);
    return NextResponse.json({ error: e?.message || "error" }, { status: 500 });
  }
}
