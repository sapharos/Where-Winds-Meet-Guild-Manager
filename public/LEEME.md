# Estaticos

Vite copia todo lo que hay aqui a la raiz del sitio al construir, asi que
`public/favicon-32.png` se sirve como `/favicon-32.png`.

El favicon se espera en tres tamanos, referenciados desde `index.html`:

- `favicon-32.png`   pestana del navegador
- `favicon-16.png`   pestana en pantallas de baja densidad
- `favicon-180.png`  acceso directo en iOS

Basta con guardar la imagen en cada tamano con esos nombres. Si solo pones
uno, el navegador lo reescala igual; se ve algo peor, pero funciona.

Para la instalacion como aplicacion (`manifest.webmanifest`) hay tres mas,
derivados del mismo dibujo de 32 px por multiplos enteros para que los trazos
queden nitidos:

- `icon-192.png`          instalacion en Android (6x32)
- `icon-512.png`          pantalla de bienvenida (16x32)
- `icon-maskable-512.png` el mismo dibujo sobre fondo opaco `#0a0f0e` y con
                          margen, para que Android pueda recortarlo en circulo
                          sin cortar el emblema
