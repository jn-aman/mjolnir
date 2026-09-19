import { useEffect, useRef } from 'react';

/**
 * A poll that stops when nobody is looking.
 *
 * Every interval in this app used to run whether or not the window was on
 * screen, so a laptop with Mjolnir behind a browser was refreshing container
 * lists every three seconds and port forwards every two, forever, on battery.
 * The work was not large; doing it for hours while minimised is the problem.
 *
 * Two rules, both from watching what the app actually does:
 *
 * **Hidden means stopped.** `visibilitychange` covers a minimised window, a
 * background tab and a locked screen, which is most of the time a desktop app
 * is open.
 *
 * **Coming back means refreshing.** A list that resumes its timer shows stale
 * data until the next tick, and the moment someone looks at a screen is
 * exactly when they want it current. So it polls immediately on return, which
 * also means a long absence costs one request rather than the hundred it
 * would have made while away.
 */
export function usePolling(
  run: () => void | Promise<unknown>,
  intervalMs: number,
  options: { readonly enabled?: boolean } = {},
): void {
  const latest = useRef(run);
  latest.current = run;
  const enabled = options.enabled ?? true;

  useEffect(() => {
    if (!enabled || intervalMs <= 0) return;
    let timer: ReturnType<typeof setInterval> | undefined;

    const tick = () => void latest.current();

    const start = () => {
      if (timer !== undefined) return;
      timer = setInterval(tick, intervalMs);
    };
    const stop = () => {
      if (timer === undefined) return;
      clearInterval(timer);
      timer = undefined;
    };

    const onVisibility = () => {
      if (document.hidden) {
        stop();
      } else {
        // Current first, then resume. Waiting a full interval to show what is
        // true is the wrong way round when someone has just looked.
        tick();
        start();
      }
    };

    if (!document.hidden) start();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      stop();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [intervalMs, enabled]);
}
