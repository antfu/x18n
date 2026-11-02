import { describe, expect, it } from 'vitest'
import { messageId } from '../src/presets/angular-localize/message-id'
import { localizeMessages, messageText, templateMessages } from '../src/presets/angular-localize/messages'
import { parseTemplate } from '../src/scanners/shared/angular-template'

// Ids from `ng extract-i18n` (Angular 22) for the same templates.
describe('angular-localize message ids', () => {
  it('names placeholders in svg and math by their namespace', () => {
    // Message and id from `ng extract-i18n`.
    const template = 'kæm<svg><path d="x"><title>t</title></path></svg><svg><foreignObject><p>x</p><b>y</b></foreignObject></svg><math><mi>x</mi></math>'
    expect(messageText(parseTemplate(template))).toBe('kæm{$START_TAG__SVG_SVG}{$START_TAG__SVG_PATH}{$START_TAG__SVG_TITLE}t{$CLOSE_TAG__SVG_TITLE}{$CLOSE_TAG__SVG_PATH}{$CLOSE_TAG__SVG_SVG}{$START_TAG__SVG_SVG}{$START_TAG__SVG_FOREIGNOBJECT}{$START_PARAGRAPH}x{$CLOSE_PARAGRAPH}{$START_BOLD_TEXT}y{$CLOSE_BOLD_TEXT}{$CLOSE_TAG__SVG_FOREIGNOBJECT}{$CLOSE_TAG__SVG_SVG}{$START_TAG__MATH_MATH}{$START_TAG__MATH_MI}x{$CLOSE_TAG__MATH_MI}{$CLOSE_TAG__MATH_MATH}')
    expect(templateMessages(`<p i18n>${template}</p>`)[0]!.id).toBe('8908621949798932713')
  })

  it('has no message for empty content, as Angular extracts none', () => {
    // Ids and the absence of the rest from `ng extract-i18n`.
    const template = [
      '<p i18n></p>',
      '<p i18n>   </p>',
      '<img i18n-alt alt="">',
      '<p i18n>{{ x }}</p>',
      '<p i18n><span></span></p>',
      '<img i18n-title title="{{ x }}">',
    ].join('\n')
    expect(templateMessages(template).map(m => m.id)).toEqual(['187187500641108332', '4174702686785761172', '187187500641108332'])
  })

  it('matches the fingerprint of @angular/localize', () => {
    expect(messageId('Hello world')).toBe('2023484548631819319')
    expect(messageId('Welcome, {$INTERPOLATION}!', 'site intro')).toBe('8889534073701065911')
    expect(messageId('Merhaba dünya 🌯')).toMatch(/^\d+$/)
  })

  it.each([
    ['<h1 i18n>Hello world</h1>', '2023484548631819319'],
    ['<p i18n="site intro|Shown on the home page">Welcome, {{ name }}!</p>', '8889534073701065911'],
    ['<p i18n>\n  Read the <a href="/docs">docs</a> or\n  <b>ask</b> on <span class="x">GitHub</span>.\n</p>', '3534615811584765247'],
    ['<p i18n>Two {{ a }} and {{ b }} values</p>', '2152711708123091458'],
    ['<img src="x.png" alt="A cat" i18n-alt />', '1310969488741942588'],
    ['<button title="Save it" i18n-title="action|Save button">Save</button>', '5996706692762201079'],
    ['<span i18n>{count, plural, =0 {no items} =1 {one item} other {{{count}} items}}</span>', '4151835343882286517'],
    ['<p i18n="second|">Same text</p>', '459041835472433076'],
    ['<p i18n>Line one<br>line two</p>', '4375059499378726008'],
    ['<div i18n>Div <ng-container>contained</ng-container> <img src="a.png" alt="x"> end</div>', '823124314976909090'],
  ])('%s', (template, id) => {
    expect(templateMessages(template).map(m => m.id)).toContain(id)
  })

  it('gives an ICU inside text a message of its own', () => {
    expect(templateMessages('<span i18n>Status: {status, select, on {active} off {inactive} other {unknown}}</span>').map(m => m.id))
      .toEqual(['1042475681916377985', '1803994859306206375'])
  })

  it('reads custom ids and $localize metadata', () => {
    expect(templateMessages('<p i18n="@@custom.id">Custom</p><a title="T" i18n-title="m|d@@nav.t">x</a>').map(m => m.id)).toEqual(['custom.id', 'nav.t'])
    expect(localizeMessages([
      'const a = $localize`Plain code message`',
      'const b = $localize`Hi ${name}, you have ${count} new`', // eslint-disable-line no-template-curly-in-string
      'const c = $localize`Hi ${name}:userName:!`', // eslint-disable-line no-template-curly-in-string
      'const d = $localize`:greeting|Greets user:Good morning`',
      'const e = $localize`:meaning|desc@@code.all:Everything ${a}:first: here`', // eslint-disable-line no-template-curly-in-string
    ].join('\n')).map(m => m.id)).toEqual([
      '4418863112096798246',
      '1959897742987971599',
      '5067194212074549402',
      '6534789568234887692',
      'code.all',
    ])
  })
})
