FROM node:22-slim
WORKDIR /app
COPY . .
ENV NODE_ENV=production DB_PATH=/data/vyora.db
VOLUME /
EXPOSE 3000
USER 
CMD ["node","--disable-warning=ExperimentalWarning","server.js"]
