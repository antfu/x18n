import type { Plugin, Scanner } from '@x18n/core'
import { rememberComments } from '../shared/comments'
import { loadParser, scanSource } from '../shared/js'

/** The AST scanner for JS and TS, driven by call specs (`usage.calls`). */
export function js(): Plugin {
  const scanner: Scanner = {
    id: 'js',
    extensions: [
      'js',
      'jsx',
      'mjs',
      'cjs',
      'ts',
      'tsx',
      'mts',
      'cts',
    ],
    async scan(file, ctx) {
      const parse = await loadParser()
      return scanSource(parse, file.text, {
        calls: ctx.calls,
        filename: file.path,
        hardStrings: true,
        ignoreCallees: ctx.config.extract.ignoreCallees,
        textAttributes: ctx.config.extract.attributes,
        // The `regex` scanner runs after this one and masks these comments.
        onParse: (program, comments) => rememberComments(file, program, comments),
      })
    },
  }
  return {
    name: 'x18n:scanner-js',
    scanners: [scanner],
  }
}

export default js
