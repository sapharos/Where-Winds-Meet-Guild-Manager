FROM node:22-alpine
WORKDIR /app

# Para las grabaciones de guerra. El trabajo normal es un remux con `-c copy`,
# que es copiar y no recodificar, y sólo la copia de 360p gasta CPU de verdad.
# Va aquí y no en un contenedor aparte porque ffmpeg es un proceso hijo y no
# bloquea el bucle de Node: la cola es de uno en uno y se lanza con `nice`, que
# cede el turno cuando el resto del Proxmox lo necesita -- mejor que un tope de
# CPU fijo, que lo frena también cuando la máquina está ociosa.
#
# yt-dlp trae al almacén las grabaciones que viven en YouTube, para servirlas
# por HLS como cualquier subida en vez de depender del iframe. Si algún día
# YouTube le cambia el terreno y la versión empaquetada deja de poder (pasa),
# la grabación se queda en modo enlace -- se ve igual, embebida -- y la
# actualización es reconstruir esta imagen.
RUN apk add --no-cache ffmpeg yt-dlp

COPY package.json ./
RUN npm install --omit=dev

COPY . .

ENV PORT=3001
EXPOSE 3001

CMD ["node", "index.js"]
