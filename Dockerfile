# --- Stage 1: Install dependencies ---
FROM oven/bun:1 AS deps

WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

# --- Stage 2: Production image ---
FROM oven/bun:1 AS runtime

# Install Python + pip for Prophet/OLS training jobs
RUN apt-get update && \
    apt-get install -y --no-install-recommends python3 python3-pip python3-venv && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy node dependencies
COPY --from=deps /app/node_modules ./node_modules

# Copy source code
COPY package.json bun.lock bunfig.toml tsconfig.json components.json ./
COPY src ./src
COPY styles ./styles
COPY sql ./sql
COPY python ./python
COPY n8n ./n8n

# Install Python dependencies in a venv
RUN python3 -m venv /app/python/.venv && \
    /app/python/.venv/bin/pip install --no-cache-dir -r python/requirements.txt

# Make sure the Python jobs use the venv
ENV PATH="/app/python/.venv/bin:$PATH"

# Port configuration
ENV PORT=3534
EXPOSE 3534

# Run the server
CMD ["bun", "src/index.ts"]
