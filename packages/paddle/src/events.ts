import { z } from 'zod';
import type { Plan } from '@mjolnir/licensing';

/**
 * Paddle notification envelope.
 *
 * Deliberately lenient about `data`: Paddle adds fields over time, and a
 * webhook handler that rejects unknown keys starts failing on a platform
 * change nobody told you about. We validate what we read and ignore the rest.
 */
export const NotificationSchema = z.looseObject({
  event_id: z.string(),
  event_type: z.string(),
  occurred_at: z.string(),
  data: z.looseObject({}).optional(),
});

export type Notification = z.infer<typeof NotificationSchema>;

const CustomerRef = z.looseObject({
  customer_id: z.string().optional(),
  id: z.string().optional(),
});

export const SubscriptionDataSchema = z.looseObject({
  id: z.string().optional(),
  status: z.string().optional(),
  customer_id: z.string().optional(),
  /** End of the paid period. Present on active and cancelling subscriptions. */
  current_billing_period: z
    .looseObject({ starts_at: z.string().optional(), ends_at: z.string().optional() })
    .optional(),
  scheduled_change: z
    .looseObject({ action: z.string().optional(), effective_at: z.string().optional() })
    .optional(),
  items: z
    .array(z.looseObject({ price: z.looseObject({ id: z.string().optional() }).optional() }))
    .optional(),
});

export const TransactionDataSchema = z.looseObject({
  id: z.string().optional(),
  status: z.string().optional(),
  customer_id: z.string().optional(),
  subscription_id: z.string().nullable().optional(),
  customer: CustomerRef.optional(),
  items: z
    .array(z.looseObject({ price: z.looseObject({ id: z.string().optional() }).optional() }))
    .optional(),
});

/**
 * Maps a Paddle price id to a plan.
 *
 * Price ids are environment-specific, sandbox and production differ, so this
 * is configuration, not a constant. Getting it wrong means selling a lifetime
 * licence and issuing a monthly one.
 */
export interface PriceCatalogue {
  readonly monthly: string;
  readonly annual: string;
  readonly lifetime: string;
}

export function planForPrice(priceId: string, catalogue: PriceCatalogue): Plan | null {
  if (priceId === catalogue.monthly) return 'monthly';
  if (priceId === catalogue.annual) return 'annual';
  if (priceId === catalogue.lifetime) return 'lifetime';
  return null;
}

function firstPriceId(items: unknown): string | null {
  if (!Array.isArray(items)) return null;
  for (const item of items) {
    const priceId = (item as { price?: { id?: unknown } })?.price?.id;
    if (typeof priceId === 'string' && priceId !== '') return priceId;
  }
  return null;
}

/** What a webhook means for the holder's licence. */
export type LicenseAction =
  | {
      readonly kind: 'issue';
      readonly customerId: string;
      readonly plan: Plan;
      /** Subscription end, or null for a lifetime purchase. */
      readonly expiresAt: Date | null;
      readonly updatesUntil: Date;
    }
  | { readonly kind: 'extend'; readonly customerId: string; readonly expiresAt: Date }
  | { readonly kind: 'revoke'; readonly customerId: string; readonly reason: string }
  | { readonly kind: 'ignore'; readonly reason: string };

const YEAR_MS = 365 * 24 * 60 * 60 * 1000;

function parseDate(value: unknown): Date | null {
  if (typeof value !== 'string') return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * Decide what a notification does to a licence.
 *
 * Pure, so the interesting cases can be tested without a Paddle account: a
 * refund must revoke, a cancellation must keep access until the period ends
 * rather than cutting it off immediately, and a lifetime purchase must never
 * be given an expiry.
 */
export function actionFor(
  notification: Notification,
  catalogue: PriceCatalogue,
  now: Date = new Date(),
): LicenseAction {
  const data = notification.data ?? {};

  switch (notification.event_type) {
    case 'transaction.completed': {
      const transaction = TransactionDataSchema.parse(data);
      const customerId = transaction.customer_id ?? transaction.customer?.id;
      if (!customerId) return { kind: 'ignore', reason: 'no customer on transaction' };

      const priceId = firstPriceId(transaction.items);
      if (!priceId) return { kind: 'ignore', reason: 'no price on transaction' };

      const plan = planForPrice(priceId, catalogue);
      if (!plan) return { kind: 'ignore', reason: `unknown price ${priceId}` };

      // Recurring plans are provisioned from subscription events, which carry
      // the authoritative period end. Handling them here too would issue a
      // licence twice on the first payment.
      if (plan !== 'lifetime') {
        return { kind: 'ignore', reason: 'recurring plan is handled by subscription events' };
      }

      return {
        kind: 'issue',
        customerId,
        plan: 'lifetime',
        expiresAt: null,
        updatesUntil: new Date(now.getTime() + YEAR_MS),
      };
    }

    case 'subscription.created':
    case 'subscription.activated': {
      const subscription = SubscriptionDataSchema.parse(data);
      const customerId = subscription.customer_id;
      if (!customerId) return { kind: 'ignore', reason: 'no customer on subscription' };

      const priceId = firstPriceId(subscription.items);
      const plan = priceId ? planForPrice(priceId, catalogue) : null;
      if (!plan || plan === 'lifetime') {
        return { kind: 'ignore', reason: 'not a recurring plan' };
      }

      const endsAt = parseDate(subscription.current_billing_period?.ends_at);
      if (!endsAt) return { kind: 'ignore', reason: 'no billing period end' };

      return { kind: 'issue', customerId, plan, expiresAt: endsAt, updatesUntil: endsAt };
    }

    case 'subscription.updated': {
      const subscription = SubscriptionDataSchema.parse(data);
      const customerId = subscription.customer_id;
      if (!customerId) return { kind: 'ignore', reason: 'no customer on subscription' };

      const endsAt = parseDate(subscription.current_billing_period?.ends_at);
      if (!endsAt) return { kind: 'ignore', reason: 'no billing period end' };

      // A scheduled cancellation is not an immediate one. The user paid for the
      // current period and keeps Pro until it ends, cutting access at the
      // cancel click is the single most common way to earn a chargeback.
      return { kind: 'extend', customerId, expiresAt: endsAt };
    }

    case 'subscription.canceled': {
      const subscription = SubscriptionDataSchema.parse(data);
      const customerId = subscription.customer_id;
      if (!customerId) return { kind: 'ignore', reason: 'no customer on subscription' };

      const endsAt = parseDate(subscription.current_billing_period?.ends_at);
      // Access runs to the end of the paid period; the licence simply stops
      // being renewed after that.
      if (endsAt && endsAt.getTime() > now.getTime()) {
        return { kind: 'extend', customerId, expiresAt: endsAt };
      }
      return { kind: 'revoke', customerId, reason: 'subscription canceled' };
    }

    case 'adjustment.created': {
      // Refunds and chargebacks. Money returned means access ends.
      const customerId = (data as { customer_id?: unknown }).customer_id;
      if (typeof customerId !== 'string') return { kind: 'ignore', reason: 'no customer on adjustment' };
      return { kind: 'revoke', customerId, reason: 'refund or chargeback' };
    }

    default:
      return { kind: 'ignore', reason: `unhandled event ${notification.event_type}` };
  }
}
