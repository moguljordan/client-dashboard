


import { onRequest } from "firebase-functions/v2/https";
import { onDocumentCreated, onDocumentUpdated } from "firebase-functions/v2/firestore";
import { defineSecret } from "firebase-functions/params";
import * as admin from "firebase-admin";
import sgMail from "@sendgrid/mail";

admin.initializeApp();
const db = admin.firestore();

// 🔐 Secrets
const SENDGRID_API_KEY = defineSecret("SENDGRID_API_KEY"); // already set via `firebase functions:secrets:set SENDGRID_API_KEY`
const NOTIFY_TO = defineSecret("NOTIFY_TO");               // optional: admin/team inbox (comma-separated)

// ⚙️ Single Sender you verified in SendGrid (Option A)
const VERIFIED_FROM = "your_verified_sender@example.com"; // <-- change to your verified Single Sender

type ProjectStatus = "new" | "in-progress" | "review" | "done";
const VALID_STATUS: ProjectStatus[] = ["new", "in-progress", "review", "done"];

// -----------------------------
// Email helpers
// -----------------------------
function setApiKey() {
  const key = SENDGRID_API_KEY.value();
  if (!key) throw new Error("Missing SENDGRID_API_KEY secret");
  sgMail.setApiKey(key);
}

async function sendEmail(toList: string[], subject: string, html: string, textFallback?: string) {
  if (!toList.length) return;

  setApiKey();
  await sgMail.sendMultiple({
    to: toList,
    from: VERIFIED_FROM,
    subject,
    text: textFallback ?? subject,
    html,
  });
}

async function resolveRecipients(uid: string): Promise<string[]> {
  const recips: string[] = [];

  // client email from users/{uid}
  const userSnap = await db.collection("users").doc(uid).get();
  const userEmail = userSnap.get("email");
  if (userEmail) recips.push(String(userEmail));

  // optional admin / team override via secret (comma-separated)
  const adminList = (NOTIFY_TO.value() || "")
    .split(",")
    .map(s => s.trim())
    .filter(Boolean);
  recips.push(...adminList);

  // de-dupe
  return Array.from(new Set(recips));
}

// -----------------------------
// 1) Your webhook: create/update users & projects (NO email here)
// -----------------------------
export const webhookHandler = onRequest({ secrets: [SENDGRID_API_KEY, NOTIFY_TO] }, async (req, res) => {
  try {
    if (req.method !== "POST") {
      res.status(405).json({ error: "Only POST requests are allowed" });
      return;
    }

    const { name, email, projects } = req.body ?? {};
    if (!email) {
      res.status(400).json({ error: "Missing required field: email" });
      return;
    }

    // Ensure Auth user exists (create if not)
    let uid: string;
    try {
      const existing = await admin.auth().getUserByEmail(email);
      uid = existing.uid;
      if (name && existing.displayName !== name) {
        await admin.auth().updateUser(uid, { displayName: name });
      }
    } catch (e: any) {
      if (e.code === "auth/user-not-found") {
        const password = Math.random().toString(36).slice(-12);
        const created = await admin.auth().createUser({
          email,
          displayName: name || email.split("@")[0],
          password,
        });
        uid = created.uid;
      } else {
        throw e;
      }
    }

    // Upsert user profile
    await db.collection("users").doc(uid).set(
      {
        name: name || null,
        email,
        role: "client",
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    // Create projects + subcollections (same structure you had)
    if (Array.isArray(projects) && projects.length > 0) {
      const projectIds: string[] = [];
      const batch = db.batch();

      projects.forEach((p: any, i: number) => {
        const projectRef = db.collection("users").doc(uid).collection("projects").doc();
        projectIds.push(projectRef.id);

        const status: ProjectStatus = VALID_STATUS.includes(p?.status) ? p.status : "new";

        batch.set(projectRef, {
          title: p?.title || `Project ${i + 1}`,
          description: p?.description || "",
          status,
          dueDate: p?.dueDate || "",
          position: i,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          priority: p?.priority || "medium",
          tags: Array.isArray(p?.tags) ? p.tags : [],
          assignedTo: uid,
        });
      });

      await batch.commit();

      // subcollections
      for (let i = 0; i < projects.length; i++) {
        const p = projects[i] || {};
        const projectId = projectIds[i];
        const projectRef = db.collection("users").doc(uid).collection("projects").doc(projectId);

        // tasks
        if (Array.isArray(p.tasks) && p.tasks.length > 0) {
          const tasksBatch = db.batch();
          p.tasks.forEach((t: any, idx: number) => {
            const tRef = projectRef.collection("tasks").doc();
            const tStatus: ProjectStatus = VALID_STATUS.includes(t?.status) ? t.status : "new";
            tasksBatch.set(tRef, {
              title: t?.title || `Task ${idx + 1}`,
              status: tStatus,
              createdAt: admin.firestore.FieldValue.serverTimestamp(),
            });
          });
          await tasksBatch.commit();
        }

        // comments
        if (Array.isArray(p.comments) && p.comments.length > 0) {
          const commentsBatch = db.batch();
          p.comments.forEach((c: any) => {
            const cRef = projectRef.collection("comments").doc();
            commentsBatch.set(cRef, {
              text: c?.text || "",
              author: c?.author || name || email,
              createdAt: admin.firestore.FieldValue.serverTimestamp(),
            });
          });
          await commentsBatch.commit();
        }

        // links
        if (Array.isArray(p.links) && p.links.length > 0) {
          const linksBatch = db.batch();
          p.links.forEach((l: any) => {
            const lRef = projectRef.collection("links").doc();
            linksBatch.set(lRef, {
              title: l?.label || l?.title || l?.url || "Link",
              url: l?.url || "",
              createdAt: admin.firestore.FieldValue.serverTimestamp(),
            });
          });
          await linksBatch.commit();
        }
      }
    }

    res.status(200).json({
      success: true,
      message: "Auth user + users/{uid} + projects + subcollections saved",
      uid,
    });
  } catch (err: any) {
    console.error("webhookHandler error:", err);
    res.status(500).json({ error: err?.message || "Internal error" });
  }
});

// -----------------------------
// 2) 🔔 NOTIFICATIONS
// -----------------------------

// a) New comment => notify
export const notifyOnNewComment = onDocumentCreated(
  {
    document: "users/{uid}/projects/{projectId}/comments/{commentId}",
    secrets: [SENDGRID_API_KEY, NOTIFY_TO],
  },
  async (event) => {
    const { uid, projectId } = event.params;
    const data = event.data?.data();
    if (!data) return;

    const recips = await resolveRecipients(uid);

    const projectSnap = await db.collection("users").doc(uid).collection("projects").doc(projectId).get();
    const projectTitle = projectSnap.get("title") || projectId;

    const author = data.author || "Someone";
    const text = data.text || "";

    const subject = `💬 New comment on "${projectTitle}"`;
    const html = `
      <p><b>${author}</b> left a comment on <b>${projectTitle}</b>:</p>
      <blockquote>${escapeHtml(text)}</blockquote>
      <p>Open your portal: <a href="https://portal.moguldesign.agency/">portal.moguldesign.agency</a></p>
    `;

    await sendEmail(recips, subject, html, `${author} commented: ${text}`);
  }
);

// b) New task => notify
export const notifyOnNewTask = onDocumentCreated(
  {
    document: "users/{uid}/projects/{projectId}/tasks/{taskId}",
    secrets: [SENDGRID_API_KEY, NOTIFY_TO],
  },
  async (event) => {
    const { uid, projectId } = event.params;
    const data = event.data?.data();
    if (!data) return;

    const recips = await resolveRecipients(uid);

    const projectSnap = await db.collection("users").doc(uid).collection("projects").doc(projectId).get();
    const projectTitle = projectSnap.get("title") || projectId;

    const title = data.title || "New Task";
    const status = data.status || "new";

    const subject = `🆕 New task in "${projectTitle}"`;
    const html = `
      <p>New task added in <b>${projectTitle}</b>:</p>
      <ul>
        <li><b>Title:</b> ${escapeHtml(title)}</li>
        <li><b>Status:</b> ${escapeHtml(status)}</li>
      </ul>
      <p>Open your portal: <a href="https://portal.moguldesign.agency/">portal.moguldesign.agency</a></p>
    `;

    await sendEmail(recips, subject, html, `New task: ${title} [${status}]`);
  }
);

// c) Project status change => notify
export const notifyOnProjectStatusChange = onDocumentUpdated(
  {
    document: "users/{uid}/projects/{projectId}",
    secrets: [SENDGRID_API_KEY, NOTIFY_TO],
  },
  async (event) => {
    const { uid, projectId } = event.params;
    const before = event.data?.before?.data();
    const after = event.data?.after?.data();
    if (!before || !after) return;

    const prev = before.status;
    const next = after.status;
    if (prev === next) return; // only notify on actual change

    const recips = await resolveRecipients(uid);

    const projectTitle = after.title || projectId;

    const subject = `🔄 "${projectTitle}" moved: ${prev} → ${next}`;
    const html = `
      <p>Project <b>${projectTitle}</b> status changed:</p>
      <p><b>${escapeHtml(String(prev))}</b> → <b>${escapeHtml(String(next))}</b></p>
      <p>Open your portal: <a href="https://portal.moguldesign.agency/">portal.moguldesign.agency</a></p>
    `;

    await sendEmail(recips, subject, html, `Status: ${prev} → ${next}`);
  }
);

// -----------------------------
// utils
// -----------------------------
function escapeHtml(str: string): string {
  const s = String(str);
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

