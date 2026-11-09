// Stockage des salons dans SQLite (Prisma). Même contrat que stockageMemoire.js.

function creerStockagePrisma(prisma) {
  const versSalon = (r) => r && { ...r }

  return {
    async lireSalon(id) {
      return versSalon(await prisma.collabRoom.findUnique({ where: { id } }))
    },
    async estArrete(id) {
      return !!(await prisma.collabRoomGone.findUnique({ where: { id }, select: { id: true } }))
    },
    async compterSalons() {
      return prisma.collabRoom.count()
    },
    async creerSalon({ id, proofHash, ownerHash }) {
      if (await this.estArrete(id)) return null
      try {
        return versSalon(await prisma.collabRoom.create({ data: { id, proofHash, ownerHash } }))
      } catch (err) {
        if (err && err.code === 'P2002') return null // créé entre-temps
        throw err
      }
    },
    async ajouter(id, s, d) {
      await prisma.$transaction([
        prisma.collabEntry.create({ data: { roomId: id, seq: s, data: d } }),
        prisma.collabRoom.update({ where: { id }, data: { lastSeq: s, bytesUsed: { increment: d.length } } }),
      ])
    },
    async entrees(id, depuis = 0) {
      const salon = await prisma.collabRoom.findUnique({ where: { id }, select: { baseSeq: true } })
      if (!salon) return []
      const where = depuis >= salon.baseSeq ? { roomId: id, seq: { gt: depuis } } : { roomId: id }
      const lignes = await prisma.collabEntry.findMany({ where, orderBy: { seq: 'asc' } })
      return lignes.map((l) => ({ s: l.seq, d: Buffer.from(l.data) }))
    },
    async compacter(id, upto, d) {
      await prisma.$transaction(async (tx) => {
        await tx.collabEntry.deleteMany({ where: { roomId: id, seq: { lte: upto } } })
        await tx.collabEntry.create({ data: { roomId: id, seq: upto, data: d } })
        const lignes = await tx.collabEntry.findMany({ where: { roomId: id }, select: { data: true } })
        const octets = lignes.reduce((n, l) => n + l.data.length, 0)
        await tx.collabRoom.update({ where: { id }, data: { baseSeq: upto, bytesUsed: octets } })
      })
    },
    async arreter(id) {
      await prisma.$transaction([
        prisma.collabRoom.deleteMany({ where: { id } }),
        prisma.collabRoomGone.upsert({ where: { id }, create: { id }, update: {} }),
      ])
    },
    async toucher(id, date) {
      await prisma.collabRoom.updateMany({ where: { id }, data: { lastSeenAt: date } })
    },
    async purger({ inactifAvant, arretesAvant }) {
      const vieux = await prisma.collabRoom.findMany({ where: { lastSeenAt: { lt: inactifAvant } }, select: { id: true } })
      for (const { id } of vieux) await this.arreter(id)
      const { count } = await prisma.collabRoomGone.deleteMany({ where: { goneAt: { lt: arretesAvant } } })
      return { inactifs: vieux.length, oublies: count }
    },
  }
}

module.exports = { creerStockagePrisma }
