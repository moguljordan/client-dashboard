/**
 * Import function triggers from their respective submodules:
 *
 * import {onCall} from "firebase-functions/v2/https";
 * import {onDocumentWritten} from "firebase-functions/v2/firestore";
 *
 * See a full list of supported triggers at https://firebase.google.com/docs/functions
 */


import * as functions from "firebase-functions";
import * as admin from "firebase-admin";

admin.initializeApp();
const db = admin.firestore();

type ProjectStatus = "new" | "in-progress" | "review" | "done";
const VALID_STATUS: ProjectStatus[] = ["new", "in-progress", "review", "done"];

/**
 * POST body shape:
 * {
 *   "name": "Client Name",
 *   "email": "client@example.com",
 *   "projects": [
 *     {
 *       "title": "Website Redesign",
 *       "description": "Optional",
 *       "status": "new|in-progress|review|done",
 *       "dueDate": "YYYY-MM-DD",
 *       "priority": "low|medium|high",
 *       "tags": ["tag1","tag2"],
 *       "tasks": [{ "title": "Task A", "status": "new" }, ...],
 *       "comments": [{ "text": "...", "author": "..." }, ...],
 *       "links": [{ "url": "https://...", "label": "Doc" }, ...]
 *     }
 *   ]
 * }
 */

export const webhookHandler = functions.https.onRequest(async (req, res): Promise<void> => {
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

    // --- Ensure Auth user exists (create if not) ---
    let uid: string;
    try {
      const existing = await admin.auth().getUserByEmail(email);
      uid = existing.uid;

      // keep displayName in sync if provided
      if (name && existing.displayName !== name) {
        await admin.auth().updateUser(uid, { displayName: name });
      }
    } catch (e: any) {
      if (e.code === "auth/user-not-found") {
        // create user with a random password
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

    // --- Upsert user profile in Firestore under 'users/{uid}' ---
    await db.collection("users").doc(uid).set(
      {
        name: name || null,
        email,
        role: "client",
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    // --- Create projects under 'users/{uid}/projects' ---
    if (Array.isArray(projects) && projects.length > 0) {
      // First, create the project docs
      const projectIds: string[] = [];
      const batch = db.batch();

      projects.forEach((p: any, i: number) => {
        const projectRef = db.collection("users").doc(uid).collection("projects").doc();
        projectIds.push(projectRef.id);

        const status: ProjectStatus = VALID_STATUS.includes(p?.status)
          ? p.status
          : "new";

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

      // Then, for each project, add subcollections: tasks, comments, links
      for (let i = 0; i < projects.length; i++) {
        const p = projects[i] || {};
        const projectId = projectIds[i];
        const projectRef = db.collection("users").doc(uid).collection("projects").doc(projectId);

        // tasks
        if (Array.isArray(p.tasks) && p.tasks.length > 0) {
          const tasksBatch = db.batch();
          p.tasks.forEach((t: any, idx: number) => {
            const tRef = projectRef.collection("tasks").doc();
            const tStatus: ProjectStatus = VALID_STATUS.includes(t?.status)
              ? t.status
              : "new";
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



// Start writing functions
// https://firebase.google.com/docs/functions/typescript

// For cost control, you can set the maximum number of containers that can be
// running at the same time. This helps mitigate the impact of unexpected
// traffic spikes by instead downgrading performance. This limit is a
// per-function limit. You can override the limit for each function using the
// `maxInstances` option in the function's options, e.g.
// `onRequest({ maxInstances: 5 }, (req, res) => { ... })`.
// NOTE: setGlobalOptions does not apply to functions using the v1 API. V1
// functions should each use functions.runWith({ maxInstances: 10 }) instead.
// In the v1 API, each function can only serve one request per container, so
// this will be the maximum concurrent request count.

// export const helloWorld = onRequest((request, response) => {
//   logger.info("Hello logs!", {structuredData: true});
//   response.send("Hello from Firebase!");
// });
