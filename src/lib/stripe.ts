import Stripe from "stripe";

// ✅ Stripe client with pinned API version (forced type so build won’t fail)
export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: "2024-06-20" as any,
});
