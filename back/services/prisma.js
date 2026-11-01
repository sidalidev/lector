// Client Prisma partagé par tout le serveur (une seule connexion SQLite).
const { PrismaClient } = require('@prisma/client')

module.exports = new PrismaClient()
