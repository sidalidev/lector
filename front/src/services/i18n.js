import en from '../locales/en'

// L'interface est en anglais seulement. Les textes français restent dans
// locales/fr.js pour plus tard (et pour les tests de textes), mais ne sont ni
// proposés ni chargés par l'app.
const LOCALES = { en }
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
