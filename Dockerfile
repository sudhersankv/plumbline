# Console build
FROM node:22-slim AS web
WORKDIR /web
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

# Platform API, serving the built console
FROM python:3.12-slim
COPY --from=ghcr.io/astral-sh/uv:0.7.12 /uv /bin/uv
WORKDIR /app
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project
COPY plumbline ./plumbline
COPY data ./data
COPY scripts ./scripts
RUN uv sync --frozen --no-dev
COPY --from=web /web/dist ./web/dist
ENV PATH="/app/.venv/bin:$PATH"
EXPOSE 8080
CMD ["uvicorn", "plumbline.api:app", "--host", "0.0.0.0", "--port", "8080"]
