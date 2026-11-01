FROM node:24-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY prisma ./prisma
RUN npx prisma generate

COPY . .

# Jamais root : le code reste à root en lecture seule, la base et les blocs
# vont dans le volume /data, à l'utilisateur node (uid 1000). Un volume neuf
# reprend ce propriétaire ; un volume existant se change une fois à la main
# (docs/BASCULE-PROD.md).
RUN mkdir -p /data && chown node:node /data
USER node

ENV DATABASE_URL="file:/data/lector.db"
EXPOSE 3456

HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://localhost:3456/v1/health || exit 1

# Forme exec et `exec node` : node reçoit SIGTERM au docker stop. Prisma est
# lancé sans npx, qui voudrait écrire son cache (système de fichiers en lecture seule).
CMD ["sh", "-c", "./node_modules/.bin/prisma db push --skip-generate && exec node index.js"]
