FROM node:20

WORKDIR /app

COPY web/package*.json ./

RUN npm ci

COPY web .

RUN npm run build

EXPOSE 3000

CMD ["npm", "start"]
