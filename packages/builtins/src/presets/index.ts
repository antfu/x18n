import type { PresetEntry } from '@x18n/core'
import angularI18next from './angular-i18next/entry'
import angularLocalize from './angular-localize/entry'
import cargoI18n from './cargo-i18n/entry'
import chromeExtension from './chrome-extension/entry'
import dotnetResx from './dotnet-resx/entry'
import easyLocalization from './easy-localization/entry'
import emberIntl from './ember-intl/entry'
import fluentReact from './fluent-react/entry'
import fluentVue from './fluent-vue/entry'
import flutterTranslate from './flutter-translate/entry'
import flutter from './flutter/entry'
import general from './general/entry'
import globalize from './globalize/entry'
import gravityUiI18n from './gravity-ui-i18n/entry'
import i18nTag from './i18n-tag/entry'
import i18nextShopify from './i18next-shopify/entry'
import i18next from './i18next/entry'
import i18nice from './i18nice/entry'
import jekyll from './jekyll/entry'
import laravelVueI18n from './laravel-vue-i18n/entry'
import laravel from './laravel/entry'
import lingui from './lingui/entry'
import nextInternational from './next-international/entry'
import nextIntl from './next-intl/entry'
import nextTranslate from './next-translate/entry'
import ngxTranslate from './ngx-translate/entry'
import nuxtI18nMicro from './nuxt-i18n-micro/entry'
import nuxtI18n from './nuxt-i18n/entry'
import paraglide from './paraglide/entry'
import phpGettext from './php-gettext/entry'
import phpJoomla from './php-joomla/entry'
import polyglot from './polyglot/entry'
import pythonGettext from './python-gettext/entry'
import reactI18next from './react-i18next/entry'
import reactIntl from './react-intl/entry'
import rubyI18nJs from './ruby-i18n-js/entry'
import rubyRails from './ruby-rails/entry'
import solidPrimitivesI18n from './solid-primitives-i18n/entry'
import svelteI18n from './svelte-i18n/entry'
import svelteI18next from './svelte-i18next/entry'
import transloco from './transloco/entry'
import typesafeI18n from './typesafe-i18n/entry'
import ui5 from './ui5/entry'
import vscodeExtension from './vscode-extension/entry'
import vueI18n from './vue-i18n/entry'

/**
 * Built-in presets by name, in detection order: every i18n-ally framework has one.
 * A preset is a folder. `<name>/entry.ts` holds its detection and a `load` for `<name>/index.ts`,
 * the preset itself; it is cheap and always loaded, while the preset is imported only when detection passes
 * or the config lists it.
 * Presets that share plugins (react-i18next, svelte-i18next and i18next) apply them once.
 */
export const presets: { readonly [name: string]: PresetEntry } = {
  'nuxt-i18n': nuxtI18n,
  'nuxt-i18n-micro': nuxtI18nMicro,
  'vue-i18n': vueI18n,
  'fluent-vue': fluentVue,
  'fluent-react': fluentReact,
  'i18next-shopify': i18nextShopify,
  'react-i18next': reactI18next,
  'svelte-i18next': svelteI18next,
  'next-translate': nextTranslate,
  'next-international': nextInternational,
  'i18next': i18next,
  'next-intl': nextIntl,
  'react-intl': reactIntl,
  'svelte-i18n': svelteI18n,
  'solid-primitives-i18n': solidPrimitivesI18n,
  'paraglide': paraglide,
  'gravity-ui-i18n': gravityUiI18n,
  'typesafe-i18n': typesafeI18n,
  'angular-localize': angularLocalize,
  'ngx-translate': ngxTranslate,
  'transloco': transloco,
  'angular-i18next': angularI18next,
  'lingui': lingui,
  'ember-intl': emberIntl,
  'polyglot': polyglot,
  'globalize': globalize,
  'i18n-tag': i18nTag,
  'ruby-i18n-js': rubyI18nJs,
  'ui5': ui5,
  'chrome-extension': chromeExtension,
  'vscode-extension': vscodeExtension,
  // Before the exclusive `laravel`, which stops the presets after it.
  'laravel-vue-i18n': laravelVueI18n,
  'laravel': laravel,
  'php-joomla': phpJoomla,
  'php-gettext': phpGettext,
  'ruby-rails': rubyRails,
  'jekyll': jekyll,
  'flutter': flutter,
  'easy-localization': easyLocalization,
  'flutter-translate': flutterTranslate,
  'python-gettext': pythonGettext,
  'i18nice': i18nice,
  'cargo-i18n': cargoI18n,
  'dotnet-resx': dotnetResx,
  'general': general,
}
