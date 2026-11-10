import en from '../locales/en'

// L'interface est en anglais seulement.
function t(key, params) {
  let str = en[key] ?? key
  if (params) {
    for (const [k, v] of Object.entries(params))
      str = str.replaceAll(`{${k}}`, v)
  }
  return str
}

// Gardées pour les appelants : une seule langue, rien à changer.
function setLocale() {}

function getLocale() { return 'en' }

export { t, setLocale, getLocale }
