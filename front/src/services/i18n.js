import en from '../locales/en'
import fr from '../locales/fr'

const LOCALES = { en, fr }
// L'interface est en anglais seulement. Les textes français restent dans
// locales/fr.js pour plus tard, mais ne sont plus proposés.
let currentLocale = 'en'

function t(key, params) {
  let str = LOCALES[currentLocale]?.[key] ?? LOCALES.en[key] ?? key
  if (params) {
    for (const [k, v] of Object.entries(params))
      str = str.replaceAll(`{${k}}`, v)
  }
  return str
}

function setLocale(lang) {
  if (lang !== 'en') return
  currentLocale = lang
  window.dispatchEvent(new Event('lector-locale-changed'))
}

function getLocale() { return currentLocale }

export { t, setLocale, getLocale }
