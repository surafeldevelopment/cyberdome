import type { Request, Response, NextFunction, RequestHandler } from 'express';
import { ZodError, type ZodTypeAny, type z } from 'zod';

export class HttpError extends Error {
  status: number;
  details?: unknown;
  constructor(status: number, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

export const notFound = (what = 'Record') => new HttpError(404, `${what} not found.`);
export const badRequest = (msg: string, details?: unknown) => new HttpError(400, msg, details);
export const conflict = (msg: string, details?: unknown) => new HttpError(409, msg, details);

/** Wrap sync/async handlers so thrown errors reach the error middleware. */
export function h(fn: (req: Request, res: Response, next: NextFunction) => any): RequestHandler {
  return (req, res, next) => {
    try {
      const r = fn(req, res, next);
      if (r && typeof r.then === 'function') r.catch(next);
    } catch (e) {
      next(e);
    }
  };
}

export function parse<S extends ZodTypeAny>(schema: S, data: unknown): z.infer<S> {
  return schema.parse(data);
}

/** Error middleware: never leaks stack traces or secrets to the client. */
export function errorHandler(err: any, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof ZodError) {
    return res.status(400).json({
      error: 'Validation failed. Check the highlighted fields.',
      issues: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    });
  }
  if (err instanceof HttpError) {
    return res.status(err.status).json({ error: err.message, details: err.details });
  }
  if (err?.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ error: 'File exceeds the configured upload size limit.' });
  }
  if (err?.type === 'entity.too.large') {
    return res.status(413).json({ error: 'Request body is too large.' });
  }
  if (err?.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'Request body is not valid JSON.' });
  }
  if (typeof err?.message === 'string' && /constraint failed/i.test(err.message)) {
    const msg = /UNIQUE/i.test(err.message)
      ? 'A record with the same unique value already exists.'
      : /FOREIGN KEY/i.test(err.message)
        ? 'This change would break a link between records.'
        : 'The value is not allowed for this field.';
    return res.status(409).json({ error: msg });
  }
  console.error('[cyberdome] unhandled error:', err?.message ?? err);
  res.status(500).json({ error: 'Internal error. The action was not completed; check the server console for details.' });
}

export function qstr(v: unknown): string | undefined {
  return typeof v === 'string' && v.length ? v : undefined;
}
