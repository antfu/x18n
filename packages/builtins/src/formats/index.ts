import type { FormatEntry } from '@x18n/core'
import androidXml from './android-xml/entry'
import arb from './arb/entry'
import ecmascript from './ecmascript/entry'
import ftl from './ftl/entry'
import ini from './ini/entry'
import json5 from './json5/entry'
import json from './json/entry'
import jsonc from './jsonc/entry'
import php from './php/entry'
import po from './po/entry'
import properties from './properties/entry'
import resx from './resx/entry'
import xliff from './xliff/entry'
import xmb from './xmb/entry'
import yaml from './yaml/entry'

/**
 * Built-in formats by id, in claim order. A format is a folder: `<name>/entry.ts` holds its extensions and a
 * `load` for `<name>/index.ts`, the format itself, which is imported when a file of that format is first read.
 */
export const formats: { readonly [id: string]: FormatEntry } = {
  json,
  jsonc,
  json5,
  yaml,
  po,
  properties,
  resx,
  'android-xml': androidXml,
  xliff,
  xmb,
  arb,
  ftl,
  ini,
  php,
  'js': ecmascript,
}
