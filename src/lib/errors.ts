/**
 * Framework-free error type shared by the API layer and the domain libraries.
 *
 * Lives apart from `./api` on purpose: importing it must never drag in
 * `next/server` or `next/headers`, so domain code that throws ApiError (e.g.
 * install-crm, apply-template) stays usable from plain Node scripts such as
 * prisma/seed.ts.
 */
export class ApiError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}
