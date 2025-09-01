// app/api/admin-ping/route.ts
import { NextResponse } from "next/server";
// IMPORTANT: this path is from app/api/admin-ping/route.ts -> src/lib/firebaseAdmin.ts
import { adminDb } from "../../../src/lib/firebaseAdmin";

export const runtime = "nodejs";

export async function GET() {
  try {
    // simple check that Admin SDK can talk to Firestore
    await adminDb.listCollections();
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "error" }, { status: 500 });
  }
}
