import type { Reporter } from '@x18n/core'
import { envelope, toWireDiagnostic } from '@x18n/core'

/** The versioned JSON contract of `x18n check --json`. */
export const jsonReporter: Reporter = {
  id: 'json',
  report(inputs, ctx) {
    const diagnostics = inputs.flatMap(input => input.diagnostics.map(d => toWireDiagnostic(input.project, d, input.text)))
    const data = {
      projects: inputs.map(input => ({
        name: input.project,
        summary: input.summary,
        coverage: input.coverage.map(c => ({
          locale: c.locale,
          total: c.total,
          translated: c.translated,
          missing: c.missing.length,
          empty: c.empty.length,
          outdated: c.outdated.length,
          needsReview: c.needsReview.length,
          reviewed: c.reviewed.length,
        })),
        // Optional: only with `--fix`.
        ...input.fix && { fix: input.fix },
      })),
      // Optional: only when a baseline applies.
      ...ctx.baseline && {
        baseline: { suppressed: ctx.baseline.suppressed, fixed: ctx.baseline.fixed },
      },
    }
    return `${JSON.stringify(envelope('check', data, diagnostics), null, 2)}\n`
  },
}

export default jsonReporter
