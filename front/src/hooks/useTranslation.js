import { useState, useEffect } from 'react'
import { t, getLocale, setLocale } from '../services/i18n'

function useTranslation() {
  const [, forceUpdate] = useState(0)

  useEffect(() => {
    const h = () => forceUpdate(n => n + 1)
    window.addEventListener('lector-locale-changed', h)
    const onStorage = (e) => { if (e.key === 'lector-locale') h() }
    window.addEventListener('storage', onStorage)
    return () => {
      window.removeEventListener('lector-locale-changed', h)
      window.removeEventListener('storage', onStorage)
    }
  }, [])

  return { t, locale: getLocale(), setLocale }
}

export default useTranslation
