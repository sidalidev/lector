// RFC 9116 : où signaler une faille ou un abus. Expires est recalculé à chaque
// requête (un an plus tard, à minuit UTC) : tant que ce serveur répond, le
// contact qu'il annonce est le bon. Policy renvoie à SECURITY.md (délais,
// périmètre, empreintes de signature) ; Canonical liste les deux domaines servis
// par ce relais (deploy/docker-compose.yml).

const CONTACT = 'mailto:contact@sidali.dev'
const POLICY = 'https://github.com/sidalidev/lector/security/policy'
const CANONICAL = [
  'https://lector.dockerbop.fr/.well-known/security.txt',
  'https://lector.sidali.dev/.well-known/security.txt',
]

function securityTxt(maintenant = new Date()) {
  const expire = new Date(Date.UTC(maintenant.getUTCFullYear() + 1, maintenant.getUTCMonth(), maintenant.getUTCDate()))
  return [
    `Contact: ${CONTACT}`,
    `Expires: ${expire.toISOString().replace(".000Z", "Z")}`,
    `Policy: ${POLICY}`,
    ...CANONICAL.map((url) => `Canonical: ${url}`),
    'Preferred-Languages: en, fr',
    '',
  ].join('\n')
}

function routeSecurityTxt(_req, res) {
  res.type('text/plain; charset=utf-8').send(securityTxt())
}

module.exports = { securityTxt, routeSecurityTxt }
