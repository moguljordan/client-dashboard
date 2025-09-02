import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { adminDb } from "@/lib/firebaseAdmin";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  // ✅ Force Stripe to use the 2024-06-20 API version, bypassing type error
  apiVersion: "2024-06-20" as any,
});

export const runtime = "nodejs";

// Save invoice under the user's subcollection
async function upsertInvoiceForUser(uid: string, invoice: Stripe.Invoice) {
  await adminDb
    .collection("users")
    .doc(uid)
    .collection("invoices")
    .doc(invoice.id)
    .set(
      {
        id: invoice.id,
        status: invoice.status,
        amount_due: invoice.amount_due,
        amount_paid: invoice.amount_paid,
        currency: invoice.currency,
        number: invoice.number,
        hosted_invoice_url: invoice.hosted_invoice_url,
        pdf: invoice.invoice_pdf,
        customer: invoice.customer || null,
        customer_email: invoice.customer_email || null,
        created: new Date(invoice.created * 1000),
        period_start: invoice.period_start
          ? new Date(invoice.period_start * 1000)
          : null,
        period_end: invoice.period_end
          ? new Date(invoice.period_end * 1000)
          : null,
      },
      { merge: true }
    );
}

export async function POST(req: NextRequest) {
  const sig = req.headers.get("stripe-signature");
  if (!sig)
    return NextResponse.json({ error: "Missing signature" }, { status: 400 });

  const rawBody = await req.text();

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(
      rawBody,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET!
    );
  } catch (err: any) {
    console.error("❌ Webhook signature error:", err.message);
    return new NextResponse(`Webhook Error: ${err.message}`, { status: 400 });
  }

  try {
    if (
      event.type === "invoice.payment_succeeded" ||
      event.type === "invoice.payment_failed" ||
      event.type === "invoice.finalized" ||
      event.type === "invoice.updated"
    ) {
      const invoice = event.data.object as Stripe.Invoice;

      let userSnap = null;

      // Try lookup by stripeCustomerId
      if (invoice.customer) {
        const byCustomer = await adminDb
          .collection("users")
          .where("stripeCustomerId", "==", invoice.customer)
          .limit(1)
          .get();
        if (!byCustomer.empty) userSnap = byCustomer.docs[0];
      }

      // Fallback: lookup by email
      if (!userSnap && invoice.customer_email) {
        const byEmail = await adminDb
          .collection("users")
          .where("email", "==", invoice.customer_email)
          .limit(1)
          .get();
        if (!byEmail.empty) {
          userSnap = byEmail.docs[0];
          // Save stripeCustomerId for future
          if (invoice.customer) {
            await userSnap.ref.set(
              { stripeCustomerId: invoice.customer as string },
              { merge: true }
            );
          }
        }
      }

      if (userSnap) {
        const uid = userSnap.id;
        await upsertInvoiceForUser(uid, invoice);
        console.log(`✅ Stored invoice ${invoice.id} for user ${uid}`);
      } else {
        console.warn("⚠️ Could not map invoice to a user", {
          customer: invoice.customer,
          email: invoice.customer_email,
          invoice: invoice.id,
        });

        // Debug: log unmapped invoices
        await adminDb
          .collection("unmapped_invoices")
          .doc(invoice.id)
          .set({
            id: invoice.id,
            type: event.type,
            customer: invoice.customer || null,
            email: invoice.customer_email || null,
            created: new Date(invoice.created * 1000),
          });
      }
    }

    // Always log raw event for debugging
    await adminDb.collection("webhook_events").doc(event.id).set({
      id: event.id,
      type: event.type,
      created: new Date(((event as any).created || Date.now()) * 1000),
      hasObject: !!event.data?.object,
    });
  } catch (e) {
    console.error("⚠️ Webhook handler error:", e);
  }

  return NextResponse.json({ received: true });
}

export async function GET() {
  return NextResponse.json({ ok: true, route: "stripe/webhook" });
}
