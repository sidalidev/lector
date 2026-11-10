// What leaves the device: the single list read by the About screen.
//
// It mirrors docs/legal/REGISTRE.md and PRIVACY.md: change them together.
// chaine/fluxSortants.test.mjs checks that every destination below is named in
// PRIVACY.md and that every entry has its texts in English and French.
//
// protection:
//   'e2e'      encrypted on the device, the server cannot read it
//   'none'     no document content; the site sees the IP address and what is requested

export const FLUX_SORTANTS = [
  { id: 'sync', destinations: ['lector.sidali.dev'], protection: 'e2e' },
  { id: 'updates', destinations: ['lector.sidali.dev', 'github.com'], protection: 'none' },
  { id: 'media', destinations: ['YouTube', 'Vimeo', 'Rumble'], protection: 'none' },
  { id: 'search', destinations: ['Google'], protection: 'none' },
]

export const PROTECTIONS = ['e2e', 'none']
