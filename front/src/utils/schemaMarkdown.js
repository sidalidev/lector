import { defaultSchema } from 'rehype-sanitize'

// Liste blanche du HTML brut accepté dans un document : celle de GitHub, plus
// ce que Lector écrit lui-même avant le rendu (titres annotés, repères de
// ligne), les maths et quelques balises de mise en forme. Jamais de script,
// d'iframe, de feuille de style, d'objet, de formulaire, de <base>, de <link>
// ni de gestionnaire d'événement ; les liens et les sources n'acceptent que
// http, https, mailto et les chemins relatifs.

// Style en ligne gardé (couleurs, alignement, tailles) sauf ce qui pourrait
// recouvrir l'interface ou charger une ressource ; sans antislash, pour qu'un
// échappement CSS ne déguise pas un mot refusé.
const STYLE_SUR = /^(?!.*(?:url\s*\(|image-set|expression|position|z-index|@import|behavior|binding|javascript:))[^<>\\]*$/is

const titre = ['dataHeaderId', 'dataHeaderText']
const a = defaultSchema.attributes

export const schemaMarkdown = {
  ...defaultSchema,
  tagNames: [
    ...defaultSchema.tagNames,
    'mark', 'u', 'small', 'abbr', 'cite', 'center',
    'figure', 'figcaption', 'caption', 'colgroup', 'col',
    'video', 'audio',
  ],
  attributes: {
    ...a,
    '*': [...a['*'], 'dataSourceLine', ['style', STYLE_SUR]],
    h1: titre,
    h2: [...a.h2, ...titre],
    h3: titre,
    h4: titre,
    h5: titre,
    h6: titre,
    code: [['className', /^language-./]],
    video: ['src', 'poster', 'controls', 'loop', 'muted', 'playsInline', 'preload'],
    audio: ['src', 'controls', 'loop', 'muted', 'preload'],
    source: [...a.source, 'src', 'type'],
  },
  protocols: { ...defaultSchema.protocols, poster: ['http', 'https'] },
  // Les id restent tels quels (sommaire, ancres, notes de bas de page) ; seul
  // name est préfixé, pour qu'un document ne puisse pas masquer document.xxx.
  clobber: ['name'],
  // Retirés avec leur contenu, qui sinon s'afficherait comme du texte.
  strip: ['script', 'style', 'iframe', 'object', 'embed', 'noscript', 'template'],
}
