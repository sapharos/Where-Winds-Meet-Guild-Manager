/**
 * Lo mínimo de la pasarela de Discord: entrar, latir y plantarse en un canal.
 *
 * Existe porque disparar un sonido del panel exige que el bot tenga un estado
 * de voz en el canal, y el estado de voz sólo se declara por la conexión
 * WebSocket (Gateway) -- no hay forma REST. Todo lo demás que hace esta
 * aplicación con Discord sigue siendo REST puro.
 *
 * Es un cliente escrito a mano y no discord.js a conciencia: la librería trae
 * decenas de dependencias y toda la pila de audio en tiempo real, y aquí no se
 * transmite audio ninguno -- el sonido vive en Discord y Discord lo reproduce.
 * Sólo hace falta el apretón de manos (HELLO → IDENTIFY → READY), el latido, y
 * el opcode 4 que dice "estoy en este canal". Node 22 trae WebSocket global,
 * así que ni siquiera hay dependencia nueva.
 *
 * La conexión se abre para el barrido y se cierra al terminar. No es una
 * presencia permanente: si Discord la corta a mitad, el barrido reporta en qué
 * canal se quedó, que para un aviso de guerra es toda la resiliencia que hace
 * falta.
 */

const GATEWAY = 'wss://gateway.discord.gg/?v=10&encoding=json';
/** GUILDS: sin él no llega el GUILD_CREATE, que es donde viene la foto de la
    voz. GUILD_VOICE_STATES: la rellena, y confirma nuestro propio estado. */
const INTENTS = (1 << 0) | (1 << 7);
const CONNECT_TIMEOUT = 15_000;
const JOIN_TIMEOUT = 8_000;

export class GatewayVoice {
  #ws = null;
  #heartbeat = null;
  #botUserId = null;
  #esperas = new Set();
  // Quién está en qué canal, según el GUILD_CREATE que sigue al READY: viene
  // con los estados de voz del momento, que es lo único que el REST no cuenta.
  #vozPorCanal = null;
  #esperandoGuild = [];

  /** Abre la conexión y espera el READY. Lanza si Discord no nos deja entrar. */
  async connect() {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error('Discord no respondió al abrir la pasarela')),
        CONNECT_TIMEOUT,
      );
      const ws = new WebSocket(GATEWAY);
      this.#ws = ws;

      ws.addEventListener('message', (raw) => {
        const msg = JSON.parse(String(raw.data));
        if (msg.op === 10) {
          // HELLO: arranca el latido y preséntate. El primer latido va ya --
          // Discord corta a quien se queda callado el intervalo entero.
          this.#heartbeat = setInterval(
            () => this.#send({ op: 1, d: null }),
            msg.d.heartbeat_interval,
          );
          this.#send({ op: 1, d: null });
          this.#send({
            op: 2,
            d: {
              token: process.env.DISCORD_BOT_TOKEN,
              intents: INTENTS,
              properties: { os: 'linux', browser: 'wwm-guild-manager', device: 'wwm-guild-manager' },
            },
          });
          return;
        }
        if (msg.t === 'READY') {
          this.#botUserId = msg.d.user.id;
          clearTimeout(timer);
          resolve();
          return;
        }
        if (msg.t === 'GUILD_CREATE' && msg.d.id === process.env.DISCORD_GUILD_ID) {
          // La foto de la voz al conectar. Sin contar al propio bot, que puede
          // haberse quedado plantado de un barrido anterior.
          const enVoz = new Set();
          for (const estado of msg.d.voice_states ?? []) {
            if (estado.channel_id && estado.user_id !== this.#botUserId) {
              enVoz.add(estado.channel_id);
            }
          }
          this.#vozPorCanal = enVoz;
          for (const espera of this.#esperandoGuild.splice(0)) espera(enVoz);
          return;
        }
        if (msg.t === 'VOICE_STATE_UPDATE' && msg.d.user_id === this.#botUserId) {
          for (const espera of [...this.#esperas]) espera(msg.d.channel_id);
        }
        // op 9 (sesión inválida) durante el barrido: el cierre hará fallar la
        // espera pendiente y el barrido reporta el canal en el que se quedó.
        if (msg.op === 9) ws.close();
      });

      ws.addEventListener('error', () => {
        clearTimeout(timer);
        reject(new Error('no se pudo abrir la pasarela de Discord'));
      });
      ws.addEventListener('close', (e) => {
        clearTimeout(timer);
        // 4004: token rechazado. Decirlo ahorra buscar en el sitio equivocado.
        reject(
          new Error(
            e.code === 4004
              ? 'Discord rechazó el token del bot en la pasarela'
              : `la pasarela se cerró (${e.code})`,
          ),
        );
        this.#cleanup();
      });
    });
  }

  /**
   * En qué canales hay alguien conectado, o null si Discord no llegó a
   * decirlo a tiempo.
   *
   * El GUILD_CREATE llega solo, justo detrás del READY; esto sólo lo espera.
   * Devuelve null y no un conjunto vacío cuando no llega, porque son
   * respuestas distintas: «no hay nadie» recorta el barrido y «no lo sé» debe
   * dejarlo entero.
   */
  async occupied(timeoutMs = 4_000) {
    if (this.#vozPorCanal) return this.#vozPorCanal;
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.#esperandoGuild = this.#esperandoGuild.filter((e) => e !== espera);
        resolve(null);
      }, timeoutMs);
      const espera = (enVoz) => {
        clearTimeout(timer);
        resolve(enVoz);
      };
      this.#esperandoGuild.push(espera);
    });
  }

  /**
   * Planta el estado de voz del bot en un canal y espera la confirmación.
   * Con null, lo saca de voz. Devuelve false si Discord no confirmó a tiempo
   * (canal borrado, permiso de Conectar ausente...), sin lanzar: en mitad de
   * un barrido eso es un resultado por canal, no un error del barrido.
   */
  async join(channelId) {
    const confirmado = new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.#esperas.delete(espera);
        resolve(false);
      }, JOIN_TIMEOUT);
      const espera = (enCanal) => {
        if (enCanal === channelId) {
          clearTimeout(timer);
          this.#esperas.delete(espera);
          resolve(true);
        }
      };
      this.#esperas.add(espera);
    });
    this.#send({
      op: 4,
      d: {
        guild_id: process.env.DISCORD_GUILD_ID,
        channel_id: channelId,
        self_mute: false,
        self_deaf: false,
      },
    });
    return confirmado;
  }

  async disconnect() {
    try {
      await this.join(null);
    } finally {
      this.#ws?.close(1000);
      this.#cleanup();
    }
  }

  #send(payload) {
    if (this.#ws?.readyState === WebSocket.OPEN) this.#ws.send(JSON.stringify(payload));
  }

  #cleanup() {
    clearInterval(this.#heartbeat);
    this.#heartbeat = null;
    this.#esperas.clear();
    for (const espera of this.#esperandoGuild.splice(0)) espera(this.#vozPorCanal);
  }
}
