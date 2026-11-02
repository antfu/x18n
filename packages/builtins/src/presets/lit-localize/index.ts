import type { Format, LocaleFinder, Preset, Scanner, UsageCandidate } from '@x18n/core'
import { createLibraryPlugin } from '@x18n/core'
import { xliff } from '../../formats/xliff'
import { litXliff } from '../../placeholders'
import { objectAt } from '../angular-i18next/scanner'
import { cook, templateParts } from '../angular-localize/messages'
import { messageId } from './message-id'

const quoted = /^(['"])((?:[^\\\n]|\\.)*?)\1/

interface Message {
  readonly parts: readonly string[]
  readonly html: boolean
  /** Where the message starts in the code, and where it ends. */
  readonly start: number
  readonly end: number
}

/** The message `msg(` holds at `at`: a string, a template, or one tagged `str` or `html`. */
function messageAt(code: string, at: number): Message | undefined {
  const tagged = /^(str|html)?\s*`/.exec(code.slice(at, at + 10))
  if (tagged) {
    const tick = at + tagged[0].length - 1
    const literal = templateParts(code, tick)
    return literal && {
      parts: literal.parts.map(cook),
      html: tagged[1] === 'html',
      start: at,
      end: literal.end,
    }
  }
  const string = quoted.exec(code.slice(at))
  return string
    ? {
        parts: [
          cook(string[2]!),
        ],
        html: false,
        start: at,
        end: at + string[0].length,
      }
    : undefined
}

const scanner: Scanner = {
  id: 'lit-localize',
  extensions: ['ts', 'js', 'mts', 'mjs', 'tsx', 'jsx'],
  scan(file) {
    if (!file.text.includes('@lit/localize'))
      return { usages: [] }
    const usages: UsageCandidate[] = []
    for (const match of file.text.matchAll(/(?<![\w.$])msg\(\s*/g)) {
      const message = messageAt(file.text, match.index + match[0].length)
      if (!message)
        continue
      const comma = /^\s*,\s*/.exec(file.text.slice(message.end))
      const options = comma && objectAt(file.text, message.end + comma[0].length)
      const id = options && /\bid\s*:\s*['"`]([^'"`]+)['"`]/.exec(options)?.[1]
      const description = options && /\bdesc\s*:\s*['"`]([^'"`]+)['"`]/.exec(options)?.[1]
      usages.push({
        raw: id ?? messageId(message.parts, message.html),
        range: { start: message.start, end: message.end },
        kind: 'marker',
        dynamic: false,
        defaultValue: message.parts.join('{}'),
        ...description
          ? { description }
          : {},
      })
    }
    return { usages }
  },
}

/**
 * `lit-localize` has no file for the source locale: each target file holds the source text in `<source>`. This reads it
 * from one of them, as a source file reads, with `target-language` and `<target>` blanked so that offsets still match.
 */
const sourceFormat: Format = {
  id: 'lit-xliff-source',
  extensions: [],
  parse(text, ctx) {
    const blank = (match: string): string => ' '.repeat(match.length)
    return xliff().formats![0]!.parse(
      text.replace(/\starget-language\s*=\s*(?:"[^"]*"|'[^']*')/g, blank).replace(/<target\b[\s\S]*?<\/target\s*>|<target\b[^>]*\/>/g, blank),
      ctx,
    )
  },
}

interface LitConfig {
  readonly sourceLocale?: string
  readonly targetLocales?: readonly string[]
  readonly interchange?: { readonly xliffDir?: string }
}

function parseConfig(text: string | undefined): LitConfig {
  try {
    return text
      ? JSON.parse(text) as LitConfig
      : {}
  }
  // A broken file is for `lit-localize` to report.
  catch {
    return {}
  }
}

/** One XLIFF per target locale, and the source locale read from the first of them, as a block that is the whole file. */
const finder: LocaleFinder = {
  id: 'lit-localize',
  async find(ctx) {
    const config = parseConfig(await ctx.host.readFile('lit-localize.json'))
    const dir = (config.interchange?.xliffDir ?? 'xliff').replace(/^\.\//, '').replace(/\/$/, '')
    const paths = await ctx.host.glob([`${dir}/*.xlf`], { gitignore: false })
    const targets = paths.map(path => ({
      path,
      locale: path.slice(dir.length + 1, -'.xlf'.length),
      namespace: undefined,
    }))
    const first = targets[0]
    if (!first)
      return []
    const source = config.sourceLocale ?? ctx.config.sourceLocale
    const text = await ctx.host.readFile(first.path) ?? ''
    return [
      {
        path: first.path,
        locale: source,
        namespace: undefined,
        format: sourceFormat.id,
        readonly: true,
        block: {
          index: 0,
          range: { start: 0, end: text.length },
          lang: source,
        },
      },
      ...targets,
    ]
  },
  resolveNew({ locale, model }) {
    return model?.finder === 'lit-localize'
      ? `${model.path.slice(0, model.path.lastIndexOf('/') + 1)}${locale}.xlf`
      : undefined
  },
}

/** `@lit/localize`: `msg()` with `str` and `html`, ids computed as `lit-localize` does, and XLIFF per target locale. */
export function litLocalize(): Preset {
  return {
    name: 'lit-localize',
    plugins: [
      createLibraryPlugin({
        name: 'x18n:lit-localize',
        keyStyle: 'flat',
        finders: [finder],
        placeholders: [litXliff],
        extra: async (draft, ctx) => {
          const config = parseConfig(await ctx.host.readFile('lit-localize.json'))
          if (config.sourceLocale && !ctx.user.sourceLocale)
            draft.sourceLocale = config.sourceLocale
        },
      }),
      {
        name: 'x18n:lit-localize-scanner',
        scanners: [scanner],
        formats: [sourceFormat],
      },
    ],
  }
}

export default litLocalize
