FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:20-alpine AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN mkdir -p public && npm run build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# Safe runtime defaults. Cloud Run or `docker run -e ...` can override any of
# these without rebuilding the image. Secrets such as GEMINI_API_KEY are never
# baked into the image and must be injected at runtime.
ENV GEMINI_TUTOR_MODEL=gemini-3.6-flash
ENV GEMINI_CLASSIFIER_MODEL=gemini-3.6-flash
ENV GEMINI_EVALUATOR_MODEL=gemini-3.6-flash
ENV GEMINI_TRANSFER_MODEL=gemini-3.6-flash
ENV GEMINI_EXTRACTION_MODEL=gemini-3.6-flash

RUN addgroup --system --gid 1001 nodejs \
  && adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs
EXPOSE 8080
ENV PORT=8080
ENV HOSTNAME=0.0.0.0

CMD ["node", "server.js"]
