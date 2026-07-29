# Estaticos

Vite copia todo lo que hay aqui a la raiz del sitio al construir, asi que
`public/favicon-32.png` se sirve como `/favicon-32.png`.

El favicon se espera en tres tamanos, referenciados desde `index.html`:

- `favicon-32.png`   pestana del navegador
- `favicon-16.png`   pestana en pantallas de baja densidad
- `favicon-180.png`  acceso directo en iOS

Basta con guardar la imagen en cada tamano con esos nombres. Si solo pones
uno, el navegador lo reescala igual; se ve algo peor, pero funciona.
