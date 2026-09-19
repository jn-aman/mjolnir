import { describe, expect, it } from 'vitest';
import { transient, trivyError } from './routes/scan.ts';

/**
 * The message a person sees when a scan fails.
 *
 * This used to be the last line of stderr, which for a Go panic is a stack
 * frame. "net/http/transport.go:1995 +0x10e4" is not an error message, it is
 * an address, and a cluster report with that beside an image is a report
 * nobody can act on.
 */
describe('reading a trivy failure', () => {
  it('takes the complaint, not the bottom of a stack trace', () => {
    const stderr = [
      '2026-09-19T15:08:21+05:30\tFATAL\tFatal error\trun error: image scan error: failed to parse the image name',
      'goroutine 1 [running]:',
      'net/http.(*Transport).roundTrip(0x140001a2000)',
      '\tnet/http/transport.go:1995 +0x10e4',
    ].join('\n');

    expect(trivyError(stderr)).toBe('image scan error: failed to parse the image name');
  });

  it('strips the timestamp and level so the sentence starts where it should', () => {
    expect(trivyError('2026-09-19T15:08:21+05:30\tFATAL\tunable to initialize: no credentials')).toBe(
      'unable to initialize: no credentials',
    );
  });

  it('falls back to the first line when nothing is marked', () => {
    expect(trivyError('something went wrong\nand then more\n')).toBe('something went wrong');
  });

  it('drops the colour codes Trivy writes when it thinks it has a terminal', () => {
    expect(trivyError('\u001b[31m2026-09-19T15:08:21+05:30\tERROR\tregistry refused the pull\u001b[0m')).toContain(
      'registry refused the pull',
    );
  });

  it('says nothing rather than something wrong for empty output', () => {
    expect(trivyError('')).toBe('');
  });
});

/**
 * Which failures are worth a second try.
 *
 * Three scans at once against one registry produces the occasional dropped
 * connection, and losing a whole image from a cluster report because of it is
 * worse than waiting another thirty seconds. Retrying something that cannot
 * work is just a slower failure, so the line has to be in the right place.
 */
describe('deciding whether to try again', () => {
  it('retries the network and the registry', () => {
    expect(transient('Get "https://registry-1.docker.io/v2/": net/http: TLS handshake timeout')).toBe(true);
    expect(transient('unexpected EOF')).toBe(true);
    expect(transient('toomanyrequests: You have reached your pull rate limit')).toBe(true);
    expect(transient('received status 503 from the registry')).toBe(true);
  });

  it('does not retry something that will fail the same way twice', () => {
    expect(transient('could not parse reference: acme/api@sha256:short')).toBe(false);
    expect(transient('unauthorized: authentication required')).toBe(false);
    expect(transient('MANIFEST_UNKNOWN: manifest unknown')).toBe(false);
  });
});
