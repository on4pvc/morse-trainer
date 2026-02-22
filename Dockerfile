FROM node:18-alpine

WORKDIR /app

# Copy package files
COPY server/package*.json ./

# Install dependencies
RUN npm ci --only=production

# Copy server code
COPY server/ ./

# Copy public files
COPY public/ ./public/

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:3000/health || exit 1

# Start server
CMD ["node", "server.js"]
