import type { DomainErrorCategory } from "../types";

/** Mänskliga felkategorier – aldrig registrar-credentials eller stacktraces i UI. */
export class DomainError extends Error {
  readonly category: DomainErrorCategory;
  readonly httpStatus: number;

  constructor(category: DomainErrorCategory, message: string, httpStatus = 400) {
    super(message);
    this.name = "DomainError";
    this.category = category;
    this.httpStatus = httpStatus;
  }
}

export function isDomainError(e: unknown): e is DomainError {
  return e instanceof DomainError;
}
