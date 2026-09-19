/**
 * Time and identity for the demo cluster.
 *
 * Their own module because two files need them and the moment both imported
 * from `cluster.ts` there was a cycle: `cluster` imports `extras`, `extras`
 * wanted `uid` from `cluster`, and the one that loaded second used a `uid`
 * that did not exist yet. A shared leaf module has no such argument to have.
 */

/**
 * One instant, captured when the demo loads, that everything else hangs off.
 *
 * Fixed within a run, so two screenshots taken a minute apart are the same
 * screenshot and a pod does not age mid-assertion. Not fixed across runs,
 * which it used to be: the anchor was a hardcoded date in March, so by
 * September every pod in the demo was six months old, every event had aged
 * out of the hour that "what broke" looks at, and the timeline was reliably
 * empty. A demo cluster has to look like a cluster somebody is using.
 */
export const START = Date.now();

export const iso = (msAgo: number): string => new Date(START - msAgo).toISOString();

export const hours = (n: number): number => n * 3_600_000;

/**
 * Sequential, not random.
 *
 * A demo screenshot taken twice should be the same screenshot, and a uid that
 * changes per run makes every diff of a recorded fixture noise.
 */
export const uid = (() => {
  let counter = 0;
  return () => `de3b0000-0000-4000-8000-${(counter++).toString(16).padStart(12, '0')}`;
})();
