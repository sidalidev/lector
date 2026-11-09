// Stockage des salons en mémoire : tests, et même contrat que stockagePrisma.js.
//
// Un salon : { id, proofHash, ownerHash, lastSeq, baseSeq, bytesUsed, createdAt, lastSeenAt }.
// Une entrée : { s, d } où d est l'enveloppe chiffrée (Buffer) ; l'entrée de
// numéro baseSeq, quand baseSeq > 0, est l'instantané compacté.

function creerStockageMemoire() {
  const salons = new Map() // id → salon
  const journaux = new Map() // id → [{ s, d }]
  const arretes = new Map() // id → date d'arrêt

  const copie = (s) => (s ? { ...s } : null)

  return {
    async lireSalon(id) {
      return copie(salons.get(id))
    },
    async estArrete(id) {
      return arretes.has(id)
    },
    async compterSalons() {
      return salons.size
    },
    async creerSalon({ id, proofHash, ownerHash }) {
      if (salons.has(id) || arretes.has(id)) return null
      const t = new Date()
      const salon = { id, proofHash, ownerHash, lastSeq: 0, baseSeq: 0, bytesUsed: 0, createdAt: t, lastSeenAt: t }
      salons.set(id, salon)
      journaux.set(id, [])
      return copie(salon)
    },
    async ajouter(id, s, d) {
      const salon = salons.get(id)
      if (!salon) throw new Error('Room gone')
      journaux.get(id).push({ s, d })
      salon.lastSeq = s
      salon.bytesUsed += d.length
    },
    async entrees(id, depuis = 0) {
      const salon = salons.get(id)
      if (!salon) return []
      const toutes = journaux.get(id)
      return depuis >= salon.baseSeq ? toutes.filter((e) => e.s > depuis) : [...toutes]
    },
    async compacter(id, upto, d) {
      const salon = salons.get(id)
      if (!salon) throw new Error('Room gone')
      const reste = journaux.get(id).filter((e) => e.s > upto)
      const journal = [{ s: upto, d }, ...reste]
      journaux.set(id, journal)
      salon.baseSeq = upto
      salon.bytesUsed = journal.reduce((n, e) => n + e.d.length, 0)
    },
    async arreter(id) {
      salons.delete(id)
      journaux.delete(id)
      arretes.set(id, new Date())
    },
    async toucher(id, date) {
      const salon = salons.get(id)
      if (salon) salon.lastSeenAt = date
    },
    async purger({ inactifAvant, arretesAvant }) {
      let inactifs = 0
      for (const [id, salon] of salons) {
        if (salon.lastSeenAt < inactifAvant) {
          await this.arreter(id)
          inactifs += 1
        }
      }
      let oublies = 0
      for (const [id, date] of arretes) {
        if (date < arretesAvant) {
          arretes.delete(id)
          oublies += 1
        }
      }
      return { inactifs, oublies }
    },
    // Tests : tout ce que le relais a gardé, octet par octet.
    _tout() {
      return { salons, journaux, arretes }
    },
  }
}

module.exports = { creerStockageMemoire }
