import type { PriceCatalogue } from './events.ts';

export type PaddleEnvironment = 'sandbox' | 'production';

/**
 * Sandbox price ids, created 2026-09-18.
 *
 * Checked in deliberately: sandbox ids are not secrets, they identify test
 * objects that cannot take real money, and having them in the repo means a
 * fresh clone can run the checkout flow without a setup ritual. Production ids
 * come from the environment — not because they are secret either, but because
 * shipping a build that charges the wrong price is worse than a missing
 * variable that fails loudly at startup.
 */
export const SANDBOX_CATALOGUE: PriceCatalogue = {
  monthly: 'pri_01m2t7znx0td7q4cyd6sjwf623',
  annual: 'pri_01m2t7zp5prmfsrstmm8h289c2',
  lifetime: 'pri_01m2t7zpftkzfykbpsya3kam68',
};

export const SANDBOX_PRODUCT_ID = 'pro_01m2t7zmxqh2mhqz3ys2kdsrjp';

export interface PaddleConfig {
  readonly environment: PaddleEnvironment;
  readonly catalogue: PriceCatalogue;
  /** Client-side token for Paddle.js. Public by design. */
  readonly clientToken: string;
  /** Notification destination secret. Server-side only — never bundled. */
  readonly webhookSecret: string;
}

class PaddleConfigError extends Error {
  constructor(missing: string[]) {
    super(`Paddle configuration incomplete: ${missing.join(', ')}`);
    this.name = 'PaddleConfigError';
  }
}

/**
 * Build configuration from the environment.
 *
 * Fails at startup rather than at checkout. A missing price id discovered when
 * a customer clicks Buy is a lost sale and a support ticket; the same problem
 * discovered on boot is a one-line fix.
 */
export function loadPaddleConfig(env: NodeJS.ProcessEnv = process.env): PaddleConfig {
  const environment: PaddleEnvironment =
    env['PADDLE_ENVIRONMENT'] === 'production' ? 'production' : 'sandbox';

  const missing: string[] = [];
  const require = (key: string): string => {
    const value = env[key];
    if (!value || value.trim() === '') {
      missing.push(key);
      return '';
    }
    return value.trim();
  };

  const clientToken = require('PADDLE_CLIENT_TOKEN');
  const webhookSecret = require('PADDLE_WEBHOOK_SECRET');

  const catalogue: PriceCatalogue =
    environment === 'production'
      ? {
          monthly: require('PADDLE_PRICE_MONTHLY'),
          annual: require('PADDLE_PRICE_ANNUAL'),
          lifetime: require('PADDLE_PRICE_LIFETIME'),
        }
      : {
          monthly: env['PADDLE_PRICE_MONTHLY']?.trim() || SANDBOX_CATALOGUE.monthly,
          annual: env['PADDLE_PRICE_ANNUAL']?.trim() || SANDBOX_CATALOGUE.annual,
          lifetime: env['PADDLE_PRICE_LIFETIME']?.trim() || SANDBOX_CATALOGUE.lifetime,
        };

  if (missing.length > 0) throw new PaddleConfigError(missing);

  return { environment, catalogue, clientToken, webhookSecret };
}

/** Display metadata for the upgrade screen. Amounts are in cents. */
export interface PlanPresentation {
  readonly plan: 'monthly' | 'annual' | 'lifetime';
  readonly label: string;
  readonly amountCents: number;
  readonly cadence: string;
  readonly note: string;
}

export const PLAN_PRESENTATION: readonly PlanPresentation[] = [
  {
    plan: 'monthly',
    label: 'Monthly',
    amountCents: 900,
    cadence: 'per month',
    note: 'Cancel any time; Pro runs to the end of the paid period.',
  },
  {
    plan: 'annual',
    label: 'Annual',
    amountCents: 9000,
    cadence: 'per year',
    note: 'Two months free compared with monthly.',
  },
  {
    plan: 'lifetime',
    label: 'Lifetime',
    amountCents: 14_900,
    cadence: 'once',
    note: 'Yours permanently, with 12 months of updates included.',
  },
];
