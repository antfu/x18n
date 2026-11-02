// gettext call names adapted from i18n-ally-next (MIT), PR #29 src/frameworks/python.ts
import type { Preset } from '@x18n/core'
import { createLibraryPlugin } from '@x18n/core'
import { pythonPercent } from '../../placeholders'

// Keys are source messages, so any text but a quote or an escape.
const quoted = [String.raw`"([^"\\\n]+)"`, String.raw`'([^'\\\n]+)'`]
const gettextCall = String.raw`(?<!\w)(?:u?gettext(?:_lazy|_noop)?|lazy_gettext|u?ngettext(?:_lazy)?|lazy_ngettext|_l|_lazy|_)\(\s*`
// The argument must end there, so `_("a" "b")` and `_("a" % x)` are not usages of `a`.
const gettextCalls = quoted.map(string => String.raw`${gettextCall}${string}(?=\s*[,)])`)
// `{% translate "x" context "y" %}` is left out: its key also holds the context.
const djangoTags = quoted.map(string => String.raw`\{%\s*trans(?:late)?\s+${string}(?=\s*(?:noop\s*)?(?:as\s+\w+\s*)?%\})`)

/** gettext in Python (Django, Flask-Babel, Babel): `.po` catalogs, `_()`, `gettext()`, `ngettext()` and Django `{% translate %}`. */
export function pythonGettext(): Preset {
  return {
    name: 'python-gettext',
    plugins: [
      createLibraryPlugin({
        name: 'x18n:python-gettext',
        regex: [
          {
            extensions: ['py'],
            patterns: gettextCalls,
          },
          {
            extensions: ['html', 'jinja', 'jinja2', 'j2'],
            patterns: [
              ...gettextCalls,
              ...djangoTags,
            ],
          },
        ],
        resources: [
          { pattern: 'locale/{locale}/LC_MESSAGES/*.po' },
          { pattern: '*/locale/{locale}/LC_MESSAGES/*.po' },
          { pattern: 'translations/{locale}/LC_MESSAGES/*.po' },
          { pattern: '*/translations/{locale}/LC_MESSAGES/*.po' },
        ],
        // gettext keys are source messages, which may hold `.` and `:`.
        keySeparator: false,
        extra: (draft) => {
          draft.extract = { keygen: 'source', ...draft.extract }
        },
        templates: [
          { template: '_("{key}")' },
        ],
        placeholders: [pythonPercent],
      }),
    ],
  }
}

export default pythonGettext
