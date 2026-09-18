import type { NextFunction, Request, Response } from 'express';
import { ApiError } from '@mjolnir/k8s';
import { logger } from '@mjolnir/logger';

const log = logger.child('http');

/**
 * One error shape for the whole API.
 *
 * The client distinguishes these codes to decide what to show: `auth` prompts a
 * session refresh, `not-found` renders an empty state, and only `internal`
 * deserves a red banner. Collapsing them into a 500 is how a UI ends up
 * shouting about a namespace that simply has no pods in it.
 */
export type ErrorCode = 'bad-request' | 'auth' | 'not-found' | 'upstream' | 'internal';

export interface ApiErrorBody {
  readonly error: { readonly code: ErrorCode; readonly message: string };
}

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'HttpError';
  }

  static badRequest(message: string): HttpError {
    return new HttpError(400, 'bad-request', message);
  }

  static notFound(message: string): HttpError {
    return new HttpError(404, 'not-found', message);
  }
}

/** Wraps an async handler so a rejected promise reaches the error middleware. */
export function handle(
  fn: (req: Request, res: Response) => Promise<unknown>,
): (req: Request, res: Response, next: NextFunction) => void {
  return (req, res, next) => {
    fn(req, res).catch(next);
  };
}

export function errorHandler(
  error: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  if (error instanceof HttpError) {
    res.status(error.status).json({ error: { code: error.code, message: error.message } });
    return;
  }

  // Translate cluster-side failures so the client can react meaningfully rather
  // than treating every upstream problem as an app crash.
  if (error instanceof ApiError) {
    if (error.isAuthFailure) {
      res.status(401).json({ error: { code: 'auth', message: error.message } });
      return;
    }
    if (error.isNotFound) {
      res.status(404).json({ error: { code: 'not-found', message: error.message } });
      return;
    }
    res.status(502).json({ error: { code: 'upstream', message: error.message } });
    return;
  }

  const message = error instanceof Error ? error.message : String(error);
  log.error('unhandled request failure', { error });
  res.status(500).json({ error: { code: 'internal', message } });
}

/** Read a required route parameter, rejecting empties rather than passing them on. */
export function param(req: Request, name: string): string {
  const value = req.params[name];
  if (typeof value !== 'string' || value === '') {
    throw HttpError.badRequest(`missing path parameter: ${name}`);
  }
  return value;
}

export function query(req: Request, name: string): string | undefined {
  const value = req.query[name];
  if (typeof value !== 'string' || value === '') return undefined;
  return value;
}

export function queryNumber(req: Request, name: string): number | undefined {
  const value = query(req, name);
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw HttpError.badRequest(`${name} must be a number`);
  return parsed;
}

export function queryBoolean(req: Request, name: string): boolean {
  return query(req, name) === 'true';
}
