/**
 * Create or update the Mjolnir Pro catalogue in Paddle.
 *
 * Idempotent: it matches the existing product by name and reuses it, so running
 * this twice does not leave two products competing for the same customers.
 *
 * The catalogue was first created through an interactive session, which is fine
 * for sandbox and unacceptable for production, a price that exists only
 * because someone once ran a command by hand is a price nobody can recreate
 * after an accident. This script is the reproducible version.
 *
 *   PADDLE_API_KEY=... npx tsx scripts/paddle-seed.ts            # sandbox
 *   PADDLE_API_KEY=... PADDLE_ENVIRONMENT=production npx tsx scripts/paddle-seed.ts
 *
 * Prints the price ids to put in PADDLE_PRICE_MONTHLY / _ANNUAL / _LIFETIME.
 */

const PRODUCT_NAME = 'Mjolnir Pro';
const PRODUCT_DESCRIPTION =
  'Multi-account cloud access, log aggregation, security scanning and background monitoring for Mjolnir.';

interface PlanSpec {
  readonly plan: 'monthly' | 'annual';
  readonly name: string;
  readonly description: string;
  /** Lowest denomination, cents for USD. */
  readonly amount: string;
  readonly billingCycle: { interval: 'month' | 'year'; frequency: number } | null;
  readonly customData: Record<string, unknown>;
}

const PLANS: readonly PlanSpec[] = [
  {
    plan: 'monthly',
    name: 'Monthly',
    description: 'Mjolnir Pro, billed monthly',
    amount: '900',
    billingCycle: { interval: 'month', frequency: 1 },
    customData: { plan: 'monthly' },
  },
  {
    plan: 'annual',
    name: 'Annual',
    description: 'Mjolnir Pro, billed yearly',
    amount: '9000',
    billingCycle: { interval: 'year', frequency: 1 },
    customData: { plan: 'annual' },
  },
];

const BASE_URL =
  process.env['PADDLE_ENVIRONMENT'] === 'production'
    ? 'https://api.paddle.com'
    : 'https://sandbox-api.paddle.com';

function apiKey(): string {
  const key = process.env['PADDLE_API_KEY'];
  if (!key) {
    throw new Error('PADDLE_API_KEY is not set');
  }
  return key;
}

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${apiKey()}`,
      'content-type': 'application/json',
      ...init.headers,
    },
  });

  const body = (await response.json()) as { data?: T; error?: { detail?: string } };
  if (!response.ok) {
    throw new Error(`${response.status} ${path}: ${body.error?.detail ?? 'request failed'}`);
  }
  return body.data as T;
}

interface Product {
  id: string;
  name: string;
}
interface Price {
  id: string;
  name?: string;
  custom_data?: { plan?: string } | null;
}

async function findProduct(): Promise<Product | null> {
  const products = await call<Product[]>('/products?per_page=200');
  return products.find((product) => product.name === PRODUCT_NAME) ?? null;
}

async function upsertProduct(): Promise<Product> {
  const existing = await findProduct();
  if (existing) {
    await call<Product>(`/products/${existing.id}`, {
      method: 'PATCH',
      body: JSON.stringify({
        description: PRODUCT_DESCRIPTION,
        custom_data: { app: 'mjolnir', tier: 'pro' },
      }),
    });
    return existing;
  }

  return call<Product>('/products', {
    method: 'POST',
    body: JSON.stringify({
      name: PRODUCT_NAME,
      description: PRODUCT_DESCRIPTION,
      tax_category: 'standard',
      custom_data: { app: 'mjolnir', tier: 'pro' },
    }),
  });
}

async function upsertPrices(productId: string): Promise<Record<string, string>> {
  const existing = await call<Price[]>(`/prices?product_id=${productId}&per_page=200`);
  const ids: Record<string, string> = {};

  for (const spec of PLANS) {
    const match = existing.find((price) => price.custom_data?.plan === spec.plan);

    if (match) {
      // Paddle does not allow changing the amount of a live price, doing so
      // would silently rewrite what existing subscribers pay. Only the safe
      // fields are patched; a price change means creating a new price.
      await call<Price>(`/prices/${match.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ name: spec.name, description: spec.description }),
      });
      ids[spec.plan] = match.id;
      continue;
    }

    const created = await call<Price>('/prices', {
      method: 'POST',
      body: JSON.stringify({
        product_id: productId,
        name: spec.name,
        description: spec.description,
        unit_price: { amount: spec.amount, currency_code: 'USD' },
        billing_cycle: spec.billingCycle,
        quantity: { minimum: 1, maximum: 1 },
        custom_data: spec.customData,
      }),
    });
    ids[spec.plan] = created.id;
  }

  return ids;
}

async function main(): Promise<void> {
  const environment = process.env['PADDLE_ENVIRONMENT'] === 'production' ? 'production' : 'sandbox';
  console.log(`Seeding Paddle catalogue in ${environment} (${BASE_URL})`);

  const product = await upsertProduct();
  console.log(`product ${product.id}, ${product.name}`);

  const ids = await upsertPrices(product.id);
  console.log('\nPrice ids:');
  for (const [plan, id] of Object.entries(ids)) {
    console.log(`  PADDLE_PRICE_${plan.toUpperCase()}=${id}`);
  }
}

await main();

export {};
