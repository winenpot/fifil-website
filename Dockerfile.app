FROM node:26-alpine
WORKDIR /app
COPY server.js server-client.js ./
COPY filfil-site/ ./filfil-site/
RUN mkdir -p /app/data && chown -R node:node /app/data
USER node
ENV PORT=8080 FILFIL_DATA_DIR=/app/data
VOLUME /app/data
EXPOSE 8080
CMD ["node", "server.js"]
