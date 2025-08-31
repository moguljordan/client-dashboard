import { onDocumentCreated, onDocumentUpdated } from "firebase-functions/v2/firestore";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { defineSecret } from "firebase-functions/params";
import * as admin from "firebase-admin";
import sgMail from "@sendgrid/mail";

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();

// 🔐 Secrets
const SENDGRID_API_KEY = defineSecret("SENDGRID_API_KEY");

// ✅ Must be your verified Single Sender in SendGrid (Option A)
const VERIFIED_FROM = "jordan@moguldesigns.agency"; // <-- change this

type Prefs = {
  email?: {
    onComment?: boolean;
    onTask?: boolean;
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
    onTask: prefs.onTask ?? true,
    onStatusChange: prefs.onStatusChange ?? true,
    mode: (prefs.mode as "immediate" | "digest-15m") ?? "digest-15m",
  };
}

/* ---------- QUEUE HELPERS ---------- */

async function enqueue(uid: string, type: "comment" | "task" | "status", projectId: string, payload: Record<string, any>) {
  await db.collection("notification_events").add({
    uid,
    type,
    projectId,
    payload,
    processed: false,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });
}

/* ---------- TRIGGERS → QUEUE (no email here) ---------- */

// New comment
export const queueOnNewComment = onDocumentCreated(
  { document: "users/{uid}/projects/{projectId}/comments/{commentId}", secrets: [SENDGRID_API_KEY] },
  async (event) => {
    const { uid, projectId } = event.params;
    const data = event.data?.data() || {};
    const prefs = await getPrefs(uid);
    if (!prefs.onComment) return;
    // immediate mode? enqueue anyway; digest will handle grouping (keeps code simple)
    await enqueue(uid, "comment", projectId, {
      author: data.author || "Someone",
      text: data.text || "",
    });
  }
);

// New task
export const queueOnNewTask = onDocumentCreated(
  { document: "users/{uid}/projects/{projectId}/tasks/{taskId}", secrets: [SENDGRID_API_KEY] },
  async (event) => {
    const { uid, projectId } = event.params;
    const data = event.data?.data() || {};
    const prefs = await getPrefs(uid);
    if (!prefs.onTask) return;
    await enqueue(uid, "task", projectId, {
      title: data.title || "New Task",
      status: data.status || "new",
    });
  }
);

// Project status change
export const queueOnProjectStatusChange = onDocumentUpdated(
  { document: "users/{uid}/projects/{projectId}", secrets: [SENDGRID_API_KEY] },
  async (event) => {
    const { uid, projectId } = event.params;
    const before = event.data?.before?.data();
    const after = event.data?.after?.data();
    if (!before || !after) return;
    if (before.status === after.status) return;

    const prefs = await getPrefs(uid);
    if (!prefs.onStatusChange) return;

    await enqueue(uid, "status", projectId, {
      title: after.title || projectId,
      from: String(before.status || ""),
      to: String(after.status || ""),
    });
  }
);

/* ---------- SCHEDULED DIGEST SENDER ---------- */

// Runs every 15 minutes, gathers unprocessed events per user, sends ONE email per user, marks processed
export const sendEmailDigests = onSchedule(
  { schedule: "every 15 minutes", timeZone: "America/Detroit", secrets: [SENDGRID_API_KEY] },
  async () => {
    setApiKey();

    // Pull a reasonable number of recent events (unprocessed)
    const cutoff = admin.firestore.Timestamp.fromDate(new Date(Date.now() - 2 * 60 * 1000)); // ignore events younger than 2 min to avoid racing
    const snap = await db
      .collection("notification_events")
      .where("processed", "==", false)
      .where("createdAt", "<=", cutoff)
      .orderBy("createdAt", "asc")
      .limit(1000)
      .get();

    if (snap.empty) return;

    // Group events by uid
    const perUser: Record<string, FirebaseFirestore.QueryDocumentSnapshot<FirebaseFirestore.DocumentData>[]> = {};
    snap.forEach((doc) => {
      const uid = doc.get("uid") as string;
      if (!perUser[uid]) perUser[uid] = [];
      perUser[uid].push(doc);
    });

    const batches: FirebaseFirestore.WriteBatch[] = [];
    let batch = db.batch();
    let ops = 0;

    for (const [uid, docs] of Object.entries(perUser)) {
      const email = await getUserEmail(uid);
      if (!email) {
        // no email on file; mark processed to avoid piling up
        docs.forEach((d) => {
          batch.update(d.ref, { processed: true, skipped: "no-email" });
          if (++ops >= 450) { batches.push(batch); batch = db.batch(); ops = 0; }
        });
        continue;
      }

      // Build a digest body
      const items = await Promise.all(
        docs.map(async (d) => {
          const type = d.get("type") as string;
          const projectId = d.get("projectId") as string;
          const payload = d.get("payload") || {};
          // Try to get project title
          const projSnap = await db.doc(`users/${uid}/projects/${projectId}`).get();
          const projectTitle = (projSnap.exists ? (projSnap.get("title") as string) : "") || projectId;

          if (type === "comment") {
            return `• 💬 <b>${escapeHtml(projectTitle)}</b> — ${escapeHtml(payload.author || "Someone")} commented: “${escapeHtml(payload.text || "")}”`;
          } else if (type === "task") {
            return `• ✅ <b>${escapeHtml(projectTitle)}</b> — Task: “${escapeHtml(payload.title || "New Task")}” [${escapeHtml(payload.status || "new")}]`;
          } else if (type === "status") {
            return `• 🔄 <b>${escapeHtml(projectTitle)}</b> — Status: ${escapeHtml(payload.from || "")} → ${escapeHtml(payload.to || "")}`;
          } else {
            return `• 📌 <b>${escapeHtml(projectTitle)}</b> — Activity`;
          }
        })
      );

      const html = `
        <p>Here’s your recent project activity:</p>
        <ul>${items.map((x) => `<li>${x}</li>`).join("")}</ul>
        <p><a href="https://portal.moguldesign.agency/">Open your portal</a></p>
      `;

      await sgMail.send({
        to: email,
        from: VERIFIED_FROM,
        subject: `Your project updates (${docs.length})`,
        text: `You have ${docs.length} new updates.`,
        html,
      });

      // Mark all processed
      docs.forEach((d) => {
        batch.update(d.ref, { processed: true, processedAt: admin.firestore.FieldValue.serverTimestamp() });
        if (++ops >= 450) { batches.push(batch); batch = db.batch(); ops = 0; }
      });
    }

    if (ops > 0) batches.push(batch);
    await Promise.all(batches.map((b) => b.commit()));
  }
);

/* ---------- utils ---------- */

function escapeHtml(str: string): string {
  const s = String(str);
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
