// scripts/backfillInvoices.js
require("dotenv").config({ path: ".env.local" });

const Stripe = require("stripe");
const path = require("path");

// ✅ Correct relative path to firebaseAdmin
let adminDb;
try {
  ({ adminDb } = require(path.join(__dirname, "../src/lib/firebaseAdmin")));
  console.log("✅ Loaded Firebase Admin from src/lib/firebaseAdmin");
} catch (e) {
  console.error("❌ Could not load ../src/lib/firebaseAdmin");
  console.error(e?.message || e);
  process.exit(1);
}

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: "2024-06-20",
});

async function sanityWrite() {
  await adminDb.collection("_script_sanity").add({ ok: true, ts: new Date() });
  console.log("✅ Firebase Admin sanity write OK");
}

async function backfill() {
  console.log("🔄 Starting backfill…");

  const usersSnap = await adminDb.collection("users").get();
  for (const doc of usersSnap.docs) {
    const data = doc.data();
    const uid = doc.id;

    const customerId = data && data.stripeCustomerId;
    if (!customerId) {
      console.log(`⏭️ Skipping user ${uid} (no stripeCustomerId)`);
      continue;
    }

    console.log(`📥 Fetching invoices for user ${uid} (${customerId})`);
    const invoices = await stripe.invoices.list({ customer: customerId, limit: 100 });

    for (const inv of invoices.data) {
      await doc.ref.collection("invoices").doc(inv.id).set(
        {
          id: inv.id,
          status: inv.status,
          amount_due: inv.amount_due,
          amount_paid: inv.amount_paid,
          currency: inv.currency,
          number: inv.number,
          hosted_invoice_url: inv.hosted_invoice_url,
          pdf: inv.invoice_pdf,
          customer: inv.customer || null,
          customer_email: inv.customer_email || null,
          created: new Date(inv.created * 1000),
          period_start: inv.period_start ? new Date(inv.period_start * 1000) : null,
          period_end: inv.period_end ? new Date(inv.period_end * 1000) : null,
        },
        { merge: true }
      );
      console.log(`✅ Stored invoice ${inv.id} for user ${uid}`);
    }
  }

  console.log("🎉 Backfill complete!");
}

(async () => {
  await sanityWrite();
  await backfill();
})().catch((e) => {
  console.error("❌ Backfill failed:", e);
  process.exit(1);
});
