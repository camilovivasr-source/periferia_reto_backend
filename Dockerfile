FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json tsconfig.build.json ./
COPY scripts ./scripts
COPY src ./src
RUN npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=8080
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
COPY agent ./agent
COPY src/knowledge ./src/knowledge
COPY docs/PRD.md ./docs/PRD.md
COPY fixtures ./fixtures
EXPOSE 8080
CMD ["npm", "start"]
