// Shared by the node side and the SPA: the SPA must send the exact queries the static build dumps.

/** Diagnostics per page of `x18n:diagnostics`. */
export const diagnosticPageSize = 200

/** Codes the locale page lists as problems of a locale. */
export const localeProblemCodes: readonly string[] = ['invalid-syntax', 'placeholder-mismatch']
