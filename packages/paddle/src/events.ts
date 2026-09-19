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
    .array(
      z.looseObject({
        price: z.looseObject({ id: z.string().optional() }).optional(),
        /** Seats. Paddle calls it quantity; it is the number of machines. */
        quantity: z.number().int().positive().optional(),
      }),
    )
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
}

export function planForPrice(priceId: string, catalogue: PriceCatalogue): Plan | null {
  if (priceId === catalogue.monthly) return 'monthly';
  if (priceId === catalogue.annual) return 'annual';
  return null;
}

/**
 * How many seats were bought.
 *
 * Paddle's `quantity` on the subscription item. Absent on a plan that was
 * created before seats existed, so the default stands in, and a customer who
 * bought before the change is not silently reduced to one machine.
 */
export function seatsFrom(items: unknown, fallback = DEFAULT_SEATS): number {
  if (!Array.isArray(items)) return fallback;
  for (const item of items) {
    const quantity = (item as { quantity?: unknown })?.quantity;
    if (typeof quantity === 'number' && Number.isInteger(quantity) && quantity > 0) return quantity;
  }
  return fallback;
}

/**
 * Seats a licence comes with.
 *
 * Five, not one. The people who buy this run a laptop, a desktop, a work
 * machine and something in a VM, and a tool that makes them choose is a tool
 * they resent on the second machine. Five costs us nothing, and it is small
 * enough that a team of twenty still has to buy twenty.
 */
export const DEFAULT_SEATS = 5;

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
      /** Subscription end. Every plan has one. */
      readonly expiresAt: Date | null;
      readonly updatesUntil: Date;
      /** Machines this licence covers, from the quantity that was paid for. */
      readonly seats: number;
      /** Paddle's subscription id, so a retry updates rather than duplicates. */
      readonly subscriptionId?: string;
    }
  | { readonly kind: 'extend'; readonly customerId: string; readonly expiresAt: Date; readonly seats?: number; readonly subscriptionId?: string }
  | { readonly kind: 'revoke'; readonly customerId: string; readonly reason: string }
  | { readonly kind: 'ignore'; readonly reason: string };


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

      /*
       * Every plan is recurring now, so a completed transaction provisions
       * nothing on its own.
       *
       * Subscription events carry the authoritative period end and arrive for
       * the same payment. Issuing from here as well would grant a licence
       * twice on the first charge, with two different end dates, and the one
       * that happened to be written last would win.
       */
      return { kind: 'ignore', reason: 'recurring plan is handled by subscription events' };
    }

    case 'subscription.created':
    case 'subscription.activated': {
      const subscription = SubscriptionDataSchema.parse(data);
      const customerId = subscription.customer_id;
      if (!customerId) return { kind: 'ignore', reason: 'no customer on subscription' };

      const priceId = firstPriceId(subscription.items);
      const plan = priceId ? planForPrice(priceId, catalogue) : null;
      if (!plan) {
        return { kind: 'ignore', reason: 'not a recurring plan' };
      }

      const endsAt = parseDate(subscription.current_billing_period?.ends_at);
      if (!endsAt) return { kind: 'ignore', reason: 'no billing period end' };

      return {
        kind: 'issue',
        customerId,
        plan,
        expiresAt: endsAt,
        updatesUntil: endsAt,
        seats: seatsFrom(subscription.items),
        ...(subscription.id ? { subscriptionId: subscription.id } : {}),
      };
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
      //
      // The quantity comes along because this is also the event that fires
      // when someone buys more seats, and a seat count that only arrives on
      // the next renewal is a seat count nobody can use today.
      return {
        kind: 'extend',
        customerId,
        expiresAt: endsAt,
        seats: seatsFrom(subscription.items),
        ...(subscription.id ? { subscriptionId: subscription.id } : {}),
      };
    }

    case 'subscription.canceled': {
      const subscription = SubscriptionDataSchema.parse(data);
      const customerId = subscription.customer_id;
      if (!customerId) return { kind: 'ignore', reason: 'no customer on subscription' };

      const endsAt = parseDate(subscription.current_billing_period?.ends_at);
      // Access runs to the end of the paid period; the licence simply stops
      // being renewed after that.
      if (endsAt && endsAt.getTime() > now.getTime()) {
        return { kind: 'extend', customerId, expiresAt: endsAt, ...(subscription.id ? { subscriptionId: subscription.id } : {}) };
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
