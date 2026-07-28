# Stage 1: build the Vite app
FROM node:22-alpine AS build
WORKDIR /app

COPY package.json ./
RUN npm install

COPY . .

# Serve at the root path inside the container (overridable at build time)
ARG BASE_PATH=/
ENV BASE_PATH=$BASE_PATH
RUN npm run build

# Stage 2: serve with nginx
FROM nginx:alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80
