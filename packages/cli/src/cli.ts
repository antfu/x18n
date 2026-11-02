import type { CAC } from 'cac'
import type { UiCommandOptions } from './commands/ui'
import type { GlobalOptions } from './context'
import process from 'node:process'
import { styleText } from 'node:util'
import { isX18nError, toErrorInfo } from '@x18n/core'
import cac from 'cac'
import { formatDiagnostic } from 'nostics'
import { ansiFormatter } from 'nostics/formatters/ansi'
import { version } from '../package.json' with { type: 'json' }
import { apply, fill, format, remove, rename, set } from './commands/change'
import { check } from './commands/check'
import { extract } from './commands/extract'
import { doctor, get, keys, locales, search, status, usages } from './commands/look'
import { migrate } from './commands/migrate'
import { prompt } from './commands/prompt'
import { review } from './commands/review'
import { eject, init, schema } from './commands/setup'
import { exitCodeOf, printJson, stdinArg, useColor } from './context'

// The UI commands pull in devframe; load them only when one runs, so other commands start fast.
const uiCommands = (): Promise<typeof import('./commands/ui')> => import('./commands/ui')

type Action = (...args: never[]) => Promise<number | void>

const paint = (format: Parameters<typeof styleText>[0]) => (text: string): string => styleText(format, text, { validateStream: false })
const formatColored = ansiFormatter({
  red: paint('red'),
  yellow: paint('yellow'),
  cyan: paint('cyan'),
  gray: paint('gray'),
  bold: paint('bold'),
  dim: paint('dim'),
})

/** Runs a command and turns errors into the JSON envelope or a printed diagnostic, with the matching exit code. */
function run(command: string, action: Action): (...args: unknown[]) => Promise<void> {
  return async (...args) => {
    const options = args.at(-1) as GlobalOptions // cac always passes the parsed options last
    try {
      const code = await (action as (...a: unknown[]) => Promise<number | void>)(...args)
      process.exitCode = code ?? 0
    }
    catch (error) {
      if (options.json) {
        printJson(command, null, [], [
          toErrorInfo(error),
        ])
      }
      else if (isX18nError(error)) {
        process.stderr.write(`${(useColor(options)
          ? formatColored
          : formatDiagnostic)(error)}\n`)
      }
      else {
        process.stderr.write(`${error instanceof Error && process.env.DEBUG
          ? error.stack
          : `error: ${toErrorInfo(error).why}`}\n`)
      }
      process.exitCode = exitCodeOf(error)
    }
  }
}

export function createCli(): CAC {
  const cli = cac('x18n')
  cli
    .option('--root <dir>', 'Project root (default: nearest config upward from the cwd)')
    .option('--config <file>', 'Explicit config file')
    .option('--project <name>', 'Pick one project in a monorepo')
    .option('--json', 'Print the JSON contract instead of human output')
    .option('--no-cache', 'Ignore the persistent cache')
    .option('--yes', 'Accept default answers for decisions')

  cli.command('', 'Show the status and the main commands').action(run('status', async (options: GlobalOptions) => {
    await status(options)
    if (!options.json)
      process.stdout.write('\nCommands: check, keys, search, get, usages, set, apply, rename, delete, fill, prompt translate, prompt setup, prompt check, ui. Run `x18n --help` for all.\n')
  }))
  cli.command('status', 'Locales with coverage, resources, keys and diagnostics').action(run('status', status))
  cli.command('keys [glob]', 'List keys')
    .option('--missing <locale>', 'Only keys missing or empty in a locale')
    .option('--unused', 'Only keys without usages')
    .option('--namespace <ns>', 'Only keys of a namespace')
    .option('--values', 'Include the value per locale')
    .option('--limit <n>', 'Page size')
    .option('--cursor <cursor>', 'Start of the page (from `nextCursor`)')
    .action(run('keys', keys))
  cli.command('search <query>', 'Find keys by their value in any locale, with their usages')
    .option('--exact', 'Only values containing the query, instead of a fuzzy match')
    .option('--limit <n>', 'Page size')
    .option('--cursor <cursor>', 'Start of the page')
    .action(run('search', search))
  cli.command('get <key>', 'Values, resources, usages and diagnostics of one key').action(run('get', get))
  cli.command('usages [key]', 'Usages of a key, or all usages')
    .option('--file <path>', 'Only usages in a file')
    .option('--limit <n>', 'Page size')
    .option('--cursor <cursor>', 'Start of the page')
    .action(run('usages', usages))
  cli.command('locales', 'Locale codes as found, with display names and resources').action(run('locales', locales))
  cli.command('doctor', 'How the project was understood: presets, finders, formats, scanners, config origins').action(run('doctor', doctor))

  cli.command('check', 'Report invalid, untranslated and unused keys, like `tsc --noEmit`')
    .option('--watch', 'Re-check on change')
    .option('--strict', 'Turn every warning into an error')
    .option('--locale <locale>', 'Only report for these locales (repeatable)')
    .option('--only <checks>', 'Only these check ids (comma separated)')
    .option('--skip <checks>', 'Skip these check ids (comma separated)')
    .option('--max-warnings <n>', 'Fail when there are more warnings')
    .option('--reporter <id>', 'pretty, json, markdown, github or sarif (repeatable)')
    .option('--output <file>', 'Write the matching reporter output to a file (repeatable)')
    .option('--baseline <file>', 'Report only diagnostics that are not in this baseline (default: .x18n/check-baseline.json, when it exists)')
    .option('--update-baseline', 'Write the current diagnostics into the baseline')
    .action(run('check', check))

  cli.command('set <key>', 'Set one value')
    .option('--locale <locale>', 'Locale (default: source locale)')
    .option('--value <value>', 'The value; `-` reads stdin')
    .option('--dry-run', 'Print the plan instead of writing')
    .action(run('set', set))
  cli.command('apply <file>', 'Batch set from JSON `{ "<locale>": { "<key>": "<value>" } }`; `-` reads stdin')
    .option('--force', 'Write values with placeholder problems')
    .option('--dry-run', 'Print the plan instead of writing')
    .action(run('apply', apply))
  cli.command('rename <from> <to>', 'Rename a key (or every key under a parent) in all locales and usages')
    .option('--no-usages', 'Keep code unchanged')
    .option('--dry-run', 'Print the plan instead of writing')
    .action(run('rename', rename))
  cli.command('delete <key>', 'Delete a key (or every key under a parent) in all locales')
    .option('--locale <locale>', 'Only in these locales (repeatable)')
    .option('--dry-run', 'Print the plan instead of writing')
    .action(run('delete', remove))
  cli.command('fill', 'Add missing keys with empty values')
    .option('--locale <locale>', 'Only these locales (repeatable)')
    .option('--copy-source', 'Use the source value instead of an empty string')
    .option('--dry-run', 'Print the plan instead of writing')
    .action(run('fill', fill))
  cli.command('format', 'Re-write resources with the configured sort and indent')
    .option('--dry-run', 'Print the plan instead of writing')
    .action(run('format', format))

  cli.command('extract [...files]', 'Find hard-coded strings and turn them into keys')
    .option('--list', 'Print candidates and proposed keys')
    .option('--plan <file>', 'Write the extraction plan to a file to edit')
    .option('--apply <file>', 'Apply an (edited) extraction plan')
    .option('--dry-run', 'Print the plan instead of writing')
    .action(run('extract', extract))

  cli.command('prompt <kind>', 'Print a prompt for an agent or LLM: `prompt translate --to <locale>`, `prompt review --locale <locale>`, or the skills `prompt setup` and `prompt check`')
    .option('--to <locale>', 'Target locale (translate)')
    .option('--locale <locale>', 'Locale to review')
    .option('--keys <glob>', 'Only keys matching a glob')
    .option('--namespace <ns>', 'Only keys of a namespace')
    .option('--limit <n>', 'Messages per prompt (default 50)')
    .option('--cursor <cursor>', 'Continue from `nextCursor`')
    .option('--format <format>', 'markdown (default) or json')
    .option('--no-context', 'Leave out code around usages')
    .option('--stale', 'Also translate stale translations (needs git history)')
    .option('--check [ids]', 'Also translate values that checks report in the target locale, such as copies of the source (`identical-to-source`); optionally only these check ids (comma separated)')
    .action(run('prompt', prompt))

  cli.command('review <action> [target]', 'Reviews: `list [key]`, `comment|approve|request-change|suggest <key>`, `resolve|apply-suggestion <id>`, `mark-fresh <key>`')
    .option('--locale <locale>', 'Locale of the message (repeatable for mark-fresh)')
    .option('--text <text>', 'Comment text')
    .option('--value <value>', 'Suggested value (suggest)')
    .option('--author <author>', 'Author as `Name <email>` (default: review.author, then git user)')
    .option('--open', 'Only unresolved reviews (list)')
    .option('--dry-run', 'Print the plan instead of writing')
    .action(run('review', review))

  cli.command('ui', 'Start the UI: browse and edit messages in the browser, with HTTP MCP at /__mcp')
    .option('--port <port>', 'Port (default: a free one from 9999)')
    .option('--host <host>', 'Bind host (default: localhost)')
    .option('--no-open', 'Do not open the browser')
    .option('--no-auth', 'Skip authentication (CI and e2e only)')
    .action(run('ui', async (options: UiCommandOptions) => (await uiCommands()).ui(options)))
  cli.command('build', 'Write a static, read-only report of the UI')
    .option('--out-dir <dir>', 'Output directory (default: .x18n/report)')
    .action(run('build', async (options: GlobalOptions & { outDir?: string }) => (await uiCommands()).build(options)))
  cli.command('mcp', 'Serve the MCP tools over stdio').action(run('mcp', async (options: GlobalOptions) => (await uiCommands()).mcp(options)))

  cli.command('init', 'Detect the setup and write x18n.config.ts')
    .option('--format <format>', 'ts (default), yml or json')
    .option('--force', 'Replace an existing config')
    .action(run('init', init))
  cli.command('migrate <source>', 'Convert i18n-ally settings: `migrate i18n-ally`')
    .option('--format <format>', 'ts (default), yml or json')
    .option('--dry-run', 'Print the files instead of writing')
    .option('--force', 'Replace an existing config')
    .action(run('migrate', migrate))
  cli.command('schema [name]', 'Print a JSON Schema: config (default), plugin or reviews').action(run('schema', schema))
  cli.command('plugin <action> <file>', 'Plugin tools: `plugin eject <file.yml>` prints the TS equivalent')
    .action(run('plugin eject', async (action: string, file: string, options: GlobalOptions) => {
      if (action !== 'eject')
        throw new Error(`unknown plugin action "${action}"`)
      await eject(file, options)
    }))

  cli.help()
  cli.version(version)
  return cli
}

// `x18n doctor | head` closes stdout early; that is not an error.
process.stdout.on('error', (error: NodeJS.ErrnoException) => {
  if (error.code === 'EPIPE')
    process.exit(0)
  throw error
})

// mri drops a lone `-`; keep it as a sentinel that `readInput` maps to stdin.
const argv = process.argv.map(arg => arg === '-'
  ? stdinArg
  : arg)
try {
  createCli().parse(argv)
}
catch (error) {
  process.stderr.write(`error: ${error instanceof Error
    ? error.message
    : String(error)}\n`)
  process.exitCode = 2
}
