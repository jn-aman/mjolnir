/**
 * Put Mjolnir's flag catalogue into Unleash.
 *
 * The catalogue in `packages/flags` is the source of truth: it is what the app
 * compiles against, and a toggle on the server that does not appear there does
 * nothing at all. This script takes that list and makes the server agree with
 * it, so nobody has to hand-type sixteen toggles into a web form and get one
 * of the names subtly wrong.
 *
 *   npm run unleash:export            write scripts/unleash-import.json
 *   npm run unleash:sync              push it, needs UNLEASH_URL and UNLEASH_TOKEN
 *
 * It is deliberately additive. Toggles that already exist keep their
 * strategies and their state, because those were set by a person deciding to
 * roll something out and this script has no business undoing that. New
 * toggles arrive disabled: a flag that turns itself on the moment it is
 * created is a flag that shipped a feature by accident.
 */
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FLAGS } from '@mjolnir/flags';

const here = dirname(fileURLToPath(import.meta.url));
const outFile = join(here, 'unleash-import.json');

const PROJECT = process.env['UNLEASH_PROJECT'] ?? 'default';
const ENVIRONMENT = process.env['UNLEASH_ENVIRONMENT'] ?? 'production';

/** The shape Unleash's import endpoint takes. */
function document_(): unknown {
  return {
    project: PROJECT,
    environment: ENVIRONMENT,
    features: FLAGS.map((flag) => ({
      name: flag.id,
      description: flag.description,
      type: flag.id.startsWith('module.') ? 'release' : flag.stage === 'experimental' || flag.stage === 'internal' ? 'experiment' : 'release',
      project: PROJECT,
      // Everything arrives off. The build default is what runs until someone
      // deliberately turns a toggle on for an environment.
      enabled: false,
      impressionData: false,
      archived: false,
      tags: [
        { type: 'simple', value: `stage:${flag.stage}` },
        { type: 'simple', value: `module:${flag.module}` },
      ],
    })),
    featureStrategies: FLAGS.map((flag) => ({
      featureName: flag.id,
      name: 'flexibleRollout',
      // Stuck to the installation id, so a machine that is inside a rollout
      // stays inside it between restarts and across releases.
      parameters: { rollout: '0', stickiness: 'userId', groupId: flag.id },
      constraints: [],
    })),
    featureEnvironments: FLAGS.map((flag) => ({ featureName: flag.id, environment: ENVIRONMENT, enabled: false })),
    tagTypes: [{ name: 'simple', description: 'Stage and module labels from the Mjolnir catalogue', icon: '#' }],
    segments: [],
  };
}

interface Step {
  readonly flag: string;
  readonly what: string;
  readonly status: number;
  readonly note?: string;
}

async function call(url: string, token: string, body: unknown, method = 'POST'): Promise<{ status: number; text: string }> {
  const response = await fetch(url, {
    method,
    headers: { Authorization: token, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: response.status, text: await response.text().catch(() => '') };
}

/**
 * Create each toggle, tag it, and set it to whatever this build already does.
 *
 * The first version of this created everything off, which was wrong in a way
 * worth writing down: the remote beats the build default, so an Unleash that
 * says "off" about a stable, on-by-default feature silently switches it off
 * for everyone the moment the server is configured. A flag server that turns
 * shipped features off by existing is a footgun, not a control plane.
 *
 * So a new toggle is created in the state the build is already in: on at 100%
 * for anything whose compiled default is true, off at 0% for everything else.
 * From there it is a deliberate change either way.
 *
 * One request per thing rather than a bulk import, because a bulk import that
 * half-applies leaves you guessing which half. A toggle that already exists is
 * left alone, since someone rolled it to 40% on purpose; `UNLEASH_ADOPT=1`
 * overrides that and pulls existing toggles back to the build defaults, which
 * is what you want exactly once, when taking over a server.
 */
async function push(): Promise<void> {
  const url = (process.env['UNLEASH_URL'] ?? 'https://unleash.mjolnir.sh').replace(/\/+$/, '');
  const token = process.env['UNLEASH_TOKEN'];
  if (!token) {
    process.stdout.write(
      `\n  UNLEASH_TOKEN is not set, so there is nothing to push with.\n` +
        `  Make an admin token in Unleash, then:\n\n` +
        `    UNLEASH_URL=${url} UNLEASH_TOKEN=... npm run unleash:sync\n\n` +
        `  The file to import by hand is ${outFile}\n\n`,
    );
    process.exit(1);
  }

  const environments = (process.env['UNLEASH_ENVIRONMENTS'] ?? ENVIRONMENT).split(',').map((name) => name.trim()).filter(Boolean);
  const adopt = process.env['UNLEASH_ADOPT'] === '1';
  const steps: Step[] = [];

  for (const flag of FLAGS) {
    const type = flag.id.startsWith('module.') ? 'release' : flag.stage === 'experimental' || flag.stage === 'internal' ? 'experiment' : 'release';
    const created = await call(`${url}/api/admin/projects/${PROJECT}/features`, token, {
      name: flag.id,
      type,
      description: flag.description,
      impressionData: false,
    });
    steps.push({
      flag: flag.id,
      what: 'create',
      status: created.status,
      ...(created.status === 409 ? { note: 'already there, left as it is' } : created.status >= 400 ? { note: created.text.slice(0, 160) } : {}),
    });
    if (created.status >= 400 && created.status !== 409) continue;

    for (const value of [`stage:${flag.stage}`, `module:${flag.module}`]) {
      await call(`${url}/api/admin/features/${encodeURIComponent(flag.id)}/tags`, token, { type: 'simple', value });
    }

    // Only a brand new toggle gets a strategy. Adding one to a toggle that
    // already exists would sit alongside whatever is really rolled out.
    if (created.status === 409 && !adopt) continue;

    for (const environment of environments) {
      const base = `${url}/api/admin/projects/${PROJECT}/features/${encodeURIComponent(flag.id)}/environments/${encodeURIComponent(environment)}`;
      const rollout = flag.fallback ? '100' : '0';

      // Adopting means replacing whatever strategies are there, so the result
      // is the build default and not the build default plus someone's old 40%.
      if (adopt) {
        const existing = await call(`${base}/strategies`, token, undefined, 'GET');
        if (existing.status < 400) {
          for (const strategy of JSON.parse(existing.text || '[]') as Array<{ id: string }>) {
            await call(`${base}/strategies/${strategy.id}`, token, undefined, 'DELETE');
          }
        }
      }

      const strategy = await call(`${base}/strategies`, token, {
        name: 'flexibleRollout',
        // Stuck to the installation id, so a machine inside a rollout stays
        // inside it between restarts and across releases.
        parameters: { rollout, stickiness: 'userId', groupId: flag.id },
        constraints: [],
      });
      steps.push({ flag: flag.id, what: `strategy in ${environment}`, status: strategy.status, ...(strategy.status >= 400 ? { note: strategy.text.slice(0, 160) } : {}) });

      const state = await call(`${base}/${flag.fallback ? 'on' : 'off'}`, token, undefined);
      steps.push({ flag: flag.id, what: `${flag.fallback ? 'on' : 'off'} in ${environment}`, status: state.status, ...(state.status >= 400 ? { note: state.text.slice(0, 160) } : {}) });
    }
  }

  const failed = steps.filter((step) => step.status >= 400 && step.status !== 409);
  const made = steps.filter((step) => step.what === 'create' && step.status < 400).length;
  const kept = steps.filter((step) => step.what === 'create' && step.status === 409).length;

  process.stdout.write(`\n  ${made} created, ${kept} already there, ${failed.length} failed.\n`);
  for (const step of failed) process.stdout.write(`  FAILED ${step.flag} ${step.what}: ${step.status} ${step.note ?? ''}\n`);
  const on = FLAGS.filter((flag) => flag.fallback).length;
  process.stdout.write(
    `\n  ${on} on at 100%, ${FLAGS.length - on} off at 0%, which is exactly what this\n` +
      `  build already does. Change one and every install follows; a machine's\n` +
      `  answer is stable once you do.\n\n`,
  );
  if (failed.length > 0) process.exit(1);
}

const mode = process.argv[2] ?? 'export';
if (mode === 'sync') {
  await push();
} else {
  writeFileSync(outFile, `${JSON.stringify(document_(), null, 2)}\n`);
  process.stdout.write(`\n  Wrote ${FLAGS.length} toggles to ${outFile}\n  Import it in Unleash, or run: npm run unleash:sync\n\n`);
}
