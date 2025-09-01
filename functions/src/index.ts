import { onDocumentCreated, onDocumentUpdated } from "firebase-functions/v2/firestore";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { defineSecret } from "firebase-functions/params";
import * as admin from "firebase-admin";
import sgMail from "@sendgrid/mail";

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();

const SENDGRID_API_KEY = defineSecret("SENDGRID_API_KEY");
const VERIFIED_FROM = "jordan@moguldesigns.agency"; // your verified sender
const FROM = { email: VERIFIED_FROM, name: "Mogul Design Agency" }; // 👈 controls display name in inbox

type Prefs = {
  email?: {
    onComment?: boolean;
    onStatusChange?: boolean;
    mode?: "immediate" | "digest-15m";
  };
};

function setApiKey() {
  const key = SENDGRID_API_KEY.value();
  if (!key) throw new Error("Missing SENDGRID_API_KEY");
  sgMail.setApiKey(key);
}

async function getUserEmail(uid: string): Promise<string | null> {
  const snap = await db.collection("users").doc(uid).get();
  return snap.exists ? (snap.get("email") as string | null) : null;
}

async function getPrefs(uid: string): Promise<Required<Prefs>["email"]> {
  const snap = await db.collection("users").doc(uid).get();
  const prefs = (snap.get("notificationPrefs") as Prefs | undefined)?.email || {};
  return {
    onComment: prefs.onComment ?? true,
    onStatusChange: prefs.onStatusChange ?? true,
    mode: (prefs.mode as "immediate" | "digest-15m") ?? "digest-15m",
  };
}

/* ---------- small helpers ---------- */
function escapeHtml(str: string): string {
  return String(str)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

async function enqueue(
  uid: string,
  type: "comment" | "status",
  projectId: string,
  payload: Record<string, any>
) {
  await db.collection("notification_events").add({
    uid,
    type,
    projectId,
    payload,
    processed: false,
    processing: false, // used to “claim” in the digest
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });
}

/* ---------- TRIGGERS → QUEUE (no email here) ---------- */

// New comment by someone other than the project owner
export const queueOnNewComment = onDocumentCreated(
  { document: "users/{uid}/projects/{projectId}/comments/{commentId}", secrets: [SENDGRID_API_KEY] },
  async (event) => {
    const { uid, projectId } = event.params; // uid = project owner
    const data = event.data?.data() || {};
    const prefs = await getPrefs(uid);
    if (!prefs.onComment) return;

    // Only notify the owner when someone ELSE comments
    const authorUid = data.authorUid as string | undefined;
    if (authorUid && authorUid === uid) return;

    await enqueue(uid, "comment", projectId, {
      author: data.author || "Someone",
      text: data.text || "",
    });
  }
);

// Project status change by someone other than the project owner
export const queueOnProjectStatusChange = onDocumentUpdated(
  { document: "users/{uid}/projects/{projectId}", secrets: [SENDGRID_API_KEY] },
  async (event) => {
    const { uid, projectId } = event.params; // uid = project owner
    const before = event.data?.before?.data();
    const after = event.data?.after?.data();
    if (!before || !after) return;

    // Only when status changed
    if (before.status === after.status) return;

    const prefs = await getPrefs(uid);
    if (!prefs.onStatusChange) return;

    // Only notify the owner when someone ELSE changed status
    const updatedBy = after.updatedBy as string | undefined;
    if (updatedBy && updatedBy === uid) return;

    await enqueue(uid, "status", projectId, {
      title: after.title || projectId,
      from: String(before.status || ""),
      to: String(after.status || ""),
    });
  }
);

/* ---------- DIGEST SENDER (every 15m), with CLAIM + DEDUPE ---------- */

export const sendEmailDigests = onSchedule(
  { schedule: "every 15 minutes", timeZone: "America/Detroit", secrets: [SENDGRID_API_KEY] },
  async () => {
    setApiKey();

    // ignore very fresh events to avoid racing with writes
    const cutoff = admin.firestore.Timestamp.fromDate(new Date(Date.now() - 2 * 60 * 1000));

    // 1) CLAIM: atomically mark a batch of events as `processing: true`
    const toClaim = await db
      .collection("notification_events")
      .where("processed", "==", false)
      .where("processing", "==", false)
      .where("createdAt", "<=", cutoff)
      .orderBy("createdAt", "asc")
      .limit(500) // safe batch size
      .get();

    if (toClaim.empty) return;

    const claimBatch = db.batch();
    toClaim.docs.forEach((d) => claimBatch.update(d.ref, { processing: true }));
    await claimBatch.commit();

    // 2) LOAD the claimed docs again (only those with processing=true)
    const claimedIds = toClaim.docs.map((d) => d.id);
    const claimed = await db.getAll(...claimedIds.map((id) => db.doc(`notification_events/${id}`)));

    // Group per user
    const perUser: Record<string, FirebaseFirestore.QueryDocumentSnapshot[]> = {};
    claimed.forEach((snap) => {
      if (!snap.exists) return;
      const data = snap.data()!;
      if (data.processed === true) return;     // already done somehow
      if (data.processing !== true) return;    // lost claim; skip
      if (data.type !== "comment" && data.type !== "status") return; // safety: status + comment only
      const uid = data.uid as string;
      (perUser[uid] ||= []).push(snap as any);
    });

    // 3) For each user, build a de-duplicated digest (collapse by project+type)
    for (const [uid, docs] of Object.entries(perUser)) {
      const email = await getUserEmail(uid);
      const userBatch = db.batch();

      if (!email) {
        // mark as processed so they don't pile up
        docs.forEach((d) => userBatch.update(d.ref, {
          processed: true,
          processing: false,
          skipped: "no-email",
          processedAt: admin.firestore.FieldValue.serverTimestamp(),
        }));
        await userBatch.commit();
        continue;
      }

      // collapse multiple entries for same (type, projectId) to the latest one
      const latestByKey = new Map<string, FirebaseFirestore.QueryDocumentSnapshot>();
      docs.forEach((d) => {
        const k = `${d.get("type")}:${d.get("projectId")}`;
        const prev = latestByKey.get(k);
        if (!prev) latestByKey.set(k, d);
        else {
          const prevAt = (prev.get("createdAt") as admin.firestore.Timestamp) ?? admin.firestore.Timestamp.fromMillis(0);
          const curAt = (d.get("createdAt") as admin.firestore.Timestamp) ?? admin.firestore.Timestamp.fromMillis(0);
          if (curAt.toMillis() >= prevAt.toMillis()) latestByKey.set(k, d);
        }
      });

      const finalDocs = Array.from(latestByKey.values());

      // Build minimal, icon-free lines
      const linesHtml: string[] = [];
      const linesText: string[] = [];

      for (const d of finalDocs) {
        const type = d.get("type") as "comment" | "status";
        const projectId = d.get("projectId") as string;
        const payload = d.get("payload") || {};
        const projSnap = await db.doc(`users/${uid}/projects/${projectId}`).get();
        const projectTitle = (projSnap.exists ? (projSnap.get("title") as string) : "") || projectId;

        if (type === "comment") {
          const textLine = `${projectTitle} — ${payload.author || "Someone"} commented: "${payload.text || ""}"`;
          linesText.push(`• ${textLine}`);
          linesHtml.push(
            `<li><strong>${escapeHtml(projectTitle)}</strong> — ${escapeHtml(payload.author || "Someone")} commented: “${escapeHtml(payload.text || "")}”</li>`
          );
        } else {
          const from = String(payload.from || "");
          const to = String(payload.to || "");
          const textLine = `${projectTitle} — Status: ${from} → ${to}`;
          linesText.push(`• ${textLine}`);
          linesHtml.push(
            `<li><strong>${escapeHtml(projectTitle)}</strong> — Status: ${escapeHtml(from)} → ${escapeHtml(to)}</li>`
          );
        }
      }

      // optional: rate-limit per user (e.g., min 10 min between sends)
      const metaRef = db.doc(`users/${uid}/_meta/emailDigest`);
      const metaSnap = await metaRef.get();
      const lastSentAt = metaSnap.exists ? (metaSnap.get("lastSentAt") as admin.firestore.Timestamp | undefined) : undefined;
      const nowMs = Date.now();
      if (lastSentAt && nowMs - lastSentAt.toMillis() < 10 * 60 * 1000) {
        // too soon → “unclaim” (so next run can include them)
        finalDocs.forEach((d) => userBatch.update(d.ref, { processing: false }));
        userBatch.set(metaRef, { lastSkippedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
        await userBatch.commit();
        continue;
      }

      // Minimal HTML (let SendGrid/template handle visual design if you want)
      const portalUrl = "https://portal.moguldesign.agency/";
      const count = finalDocs.length;
      const todayStr = new Date().toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });

      const html = `
        <p>Recent project activity (${count}) — ${escapeHtml(todayStr)}</p>
        <ul>${linesHtml.length ? linesHtml.join("") : `<li>No new activity.</li>`}</ul>
        <p><a href="${portalUrl}">Open your portal</a></p>
      `;

      const text = [
        `Recent project activity (${count}) — ${todayStr}`,
        "",
        ...(linesText.length ? linesText : ["No new activity."]),
        "",
        `Open your portal: ${portalUrl}`,
      ].join("\n");

      // send once per user — with display name
      await sgMail.send({
        to: email,
        from: FROM, // 👈 ensures inbox shows “Mogul Design Agency”
        subject: `Project activity (${count}) – ${todayStr}`,
        text,
        html,
        // If you're using a SendGrid Dynamic Template instead, replace with:
        // templateId: "d-XXXXXXXXXXXXXXX",
        // dynamicTemplateData: { count, date: todayStr, items: linesText, portalUrl },
      });

      // mark processed
      finalDocs.forEach((d) => userBatch.update(d.ref, {
        processed: true,
        processing: false,
        processedAt: admin.firestore.FieldValue.serverTimestamp(),
      }));
      userBatch.set(metaRef, { lastSentAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
      await userBatch.commit();
    }
  }
);
