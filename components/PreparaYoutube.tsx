import React, { useState } from 'react';
import Sheet from './Sheet';
import MarcaDeReloj from './MarcaDeReloj';
import YouTubeVideo from './YouTubeVideo';
import { enPalabras } from '../services/relojGuerra';

/**
 * Traer una grabación que ya vive en YouTube: pegar el enlace, y de paso
 * sincronizarla. El gemelo de PreparaVod para quien no puede subir el fichero.
 *
 * La sincronía se ofrece AQUÍ y no después por lo mismo que en la subida: es
 * el único momento en que quien trae el vídeo está delante de él con calma. La
 * diferencia con el fichero local es que aquí no hay OCR -- un iframe de otro
 * dominio no deja leer sus fotogramas -- así que se hace a mano con el mismo
 * formulario del reproductor: pausa donde se lea el cronómetro y di qué marca.
 *
 * La duración sale del propio reproductor de YouTube, y por eso hay que darle
 * al play un momento: hasta que el vídeo arranca, YouTube no la dice. Sin
 * duración no se sabe qué tramo cubre y no podría entrar nunca en un mosaico,
 * así que se exige en vez de dejar una fila coja.
 */

/** Gemelo de `extraerYoutubeId` en server/vods.js: las mismas formas de enlace. */
const extraerId = (texto: string): string | null => {
  const crudo = texto.trim();
  if (/^[A-Za-z0-9_-]{11}$/.test(crudo)) return crudo;
  let url: URL;
  try {
    url = new URL(crudo);
  } catch {
    return null;
  }
  const host = url.hostname.replace(/^(www|m|music)\./, '');
  let id: string | null = null;
  if (host === 'youtu.be') id = url.pathname.slice(1).split('/')[0];
  else if (host === 'youtube.com') {
    id =
      url.pathname === '/watch'
        ? url.searchParams.get('v')
        : (url.pathname.match(/^\/(?:live|shorts|embed|v)\/([^/?]+)/)?.[1] ?? null);
  }
  return id && /^[A-Za-z0-9_-]{11}$/.test(id) ? id : null;
};

interface Props {
  /** A nombre de quién queda, ya decidido en la cabecera de Grabaciones. */
  deQuien: string | null;
  onCancelar: () => void;
  onEnviar: (datos: {
    url: string;
    duracionMs: number;
    offsetMs: number | null;
    confianza: 'manual' | null;
  }) => Promise<void>;
}

const PreparaYoutube: React.FC<Props> = ({ deQuien, onCancelar, onEnviar }) => {
  const [url, setUrl] = useState('');
  const [posicion, setPosicion] = useState(0);
  const [duracion, setDuracion] = useState(0);
  const [offsetMs, setOffsetMs] = useState<number | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const videoId = extraerId(url);

  const enviar = async () => {
    if (!videoId || !duracion) return;
    setEnviando(true);
    setError(null);
    try {
      await onEnviar({
        url: url.trim(),
        duracionMs: Math.round(duracion * 1000),
        offsetMs,
        confianza: offsetMs !== null ? 'manual' : null,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo añadir el enlace');
      setEnviando(false);
    }
  };

  return (
    <Sheet
      title="Traer de YouTube"
      subtitle={
        deQuien
          ? `El enlace queda a nombre de ${deQuien}, y un oficial tendrá que publicarlo, como cualquier subida.`
          : 'El vídeo se queda en tu canal; aquí sólo se guarda el enlace. Un oficial tendrá que publicarlo, como cualquier subida.'
      }
      size="md"
      onClose={onCancelar}
    >
      <div className="space-y-4">
        <div>
          <label className="block text-[11px] uppercase tracking-wider text-slate-500 mb-1.5">
            Enlace del vídeo
          </label>
          <input
            type="url"
            autoFocus
            value={url}
            onChange={(e) => {
              setUrl(e.target.value);
              setError(null);
              // Enlace nuevo, cuentas nuevas: lo leído era del vídeo anterior.
              setDuracion(0);
              setOffsetMs(null);
            }}
            placeholder="https://youtu.be/…"
            autoComplete="off"
            className="w-full min-h-tap bg-slate-950 border border-slate-800 rounded px-3 text-sm outline-none focus:ring-1 focus:ring-amber-500"
          />
          {url.trim() && !videoId && (
            <p className="mt-1.5 text-[11px] text-amber-400">
              Eso no parece un enlace de YouTube. Vale el de «Compartir», el de la barra del
              navegador, o el id del vídeo a secas.
            </p>
          )}
        </div>

        {videoId && (
          <>
            {/* Interactivo a conciencia: aquí mandan los controles de YouTube,
                porque hay que poder buscar el momento del cronómetro antes de
                que exista nuestra fila con sus propios mandos. */}
            <YouTubeVideo
              key={videoId}
              videoId={videoId}
              interactivo
              className="w-full aspect-video rounded-lg overflow-hidden"
              onTiempo={(pos, dur) => {
                setPosicion(pos);
                if (dur) setDuracion(dur);
              }}
              onError={setError}
            />

            {!duracion && (
              <p className="text-[11px] text-slate-500">
                <i className="fa-solid fa-circle-info mr-1.5" aria-hidden="true" />
                Dale a reproducir un momento: hasta que el vídeo arranca, YouTube no dice cuánto
                dura, y sin la duración no se sabe qué tramo de la guerra cubre.
              </p>
            )}

            {/*
              La sincronía, opcional pero ofrecida ahora. Sin ella la grabación
              se puede ver igual, pero no lleva marcas ni entra en un mosaico
              -- lo mismo que una subida a la que el OCR le falló -- y quien
              edita la guerra puede corregirla después desde «Ver».
            */}
            <div className="rounded-lg border border-slate-800 p-3">
              <p className="text-[11px] uppercase tracking-wider text-slate-500 mb-2">
                Sincronía con la guerra
              </p>
              {offsetMs !== null ? (
                <p className="text-[11px] text-slate-400">
                  Esta grabación <span className="text-slate-200">{enPalabras(offsetMs)}</span>.{' '}
                  <button
                    type="button"
                    onClick={() => setOffsetMs(null)}
                    className="tap-suelto underline hover:text-slate-300"
                  >
                    corregir
                  </button>
                </p>
              ) : (
                <>
                  <MarcaDeReloj posicionS={posicion} onAplicar={setOffsetMs} />
                  <p className="mt-2 text-[11px] text-slate-500">
                    Se puede dejar para luego, pero sin sincronizar no lleva marcas ni entra en el
                    mosaico.
                  </p>
                </>
              )}
            </div>
          </>
        )}

        {error && (
          <div className="text-sm rounded-lg px-4 py-2 flex items-center gap-3 border bg-red-950/60 border-red-900 text-red-200">
            <i className="fa-solid fa-triangle-exclamation" aria-hidden="true" />
            {error}
          </div>
        )}

        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onCancelar}
            className="px-3 min-h-tap rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs"
          >
            Cancelar
          </button>
          <button
            type="button"
            disabled={!videoId || !duracion || enviando}
            onClick={() => void enviar()}
            title={
              !videoId
                ? 'Pega primero el enlace'
                : !duracion
                  ? 'Reproduce un momento el vídeo para leer su duración'
                  : undefined
            }
            className="px-4 min-h-tap rounded-lg bg-amber-600 hover:bg-amber-500 disabled:bg-slate-800 disabled:text-slate-600 text-white text-xs font-bold flex items-center gap-2"
          >
            <i
              className={`fa-solid ${enviando ? 'fa-circle-notch fa-spin' : 'fa-link'}`}
              aria-hidden="true"
            />
            Añadir al acta
          </button>
        </div>
      </div>
    </Sheet>
  );
};

export default PreparaYoutube;
