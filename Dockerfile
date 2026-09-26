# 联机后端镜像：只跑房间服务（房间状态在内存里，所以副本数保持 1）
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8787
COPY package.json ./
COPY server.mjs ./
COPY src ./src
COPY web ./web
COPY cli ./cli
COPY tools ./tools
COPY docs ./docs
COPY README.md ./
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8787)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.mjs"]
