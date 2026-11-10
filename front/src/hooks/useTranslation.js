import { t, getLocale, setLocale } from '../services/i18n'

// Une seule langue : les textes ne changent jamais, rien à écouter.
function useTranslation() {
  return { t, locale: getLocale(), setLocale }
}

export default useTranslation
