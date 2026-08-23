import React, { useEffect, useRef, useState } from 'react';
import Sheet from './Sheet';
import { enPalabras, sondearReloj } from '../services/relojGuerra';
import MarcaDeReloj from './MarcaDeReloj';

/**
 * Lo que pasa entre elegir el fichero y subirlo. Ver docs/VODS.md §4.
 *
 * Dos cosas se deciden aquí y las dos ahorran disco o trabajo después:
 *
 * - **Dónde empieza y dónde acaba.** Mucha gente graba desde antes de entrar y
 *   deja correr la grabación después; sin recorte el almacén se va al doble de
 *   lo estimado. El corte se aplica luego en el servidor, en el remux que ya se
 *   iba a hacer, así que aquí sólo se eligen dos números.
 * - **En qué momento de la guerra empieza.** Es de lo que depende el
 *   multistream, y se lee del cronómetro del propio juego.
 *
 * Todo ocurre sobre el fichero **local**: se reproduce con `createObjectURL` y
 * no se ha subido ni un byte todavía. Marcar el recorte antes de subir es lo
 * que hace que quien tenga que cortar media hora no la suba para nada.
 */

interface Props {
  fichero: File;
  onCancelar: () => void;
  onListo: (datos: {
    recorteIniMs: number | null;
    recorteFinMs: number | null;
    offsetMs: number | null;
    confianza: 'ocr' | 'nombre' | 'manual' | null;
  }) => void;
}

const reloj = (s: number) =>
  `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

const PreparaVod: React.FC<Props> = ({ fichero, onCancelar, onListo }) => {
  const video = useRef<HTMLVideoElement>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [posicion, setPosicion] = useState(0);
  const [duracion, setDuracion] = useState(0);
  const [ilegible, setIlegible] = useState(false);

  const [entrada, setEntrada] = useState<number | null>(null);
  const [salida, setSalida] = useState<number | null>(null);

  const [offsetMs, setOffsetMs] = useState<number | null>(null);
  const [confianza, setConfianza] = useState<'ocr' | 'nombre' | 'manual' | null>(null);
  const [leyendo, setLeyendo] = useState(true);
  const [progreso, setProgreso] = useState('Preparando…');
  const [problema, setProblema] = useState<string | null>(null);

  /**
   * La URL del fichero local se crea DENTRO del efecto y se guarda en estado.
   *
   * Crearla en un inicializador de `useState` y revocarla en la limpieza no
   * vale, y el motivo cuesta de ver: en StrictMode --que esta aplicación usa
   * también en producción-- React monta, limpia y vuelve a montar. La limpieza
   * revocaba la URL, el segundo montaje reutilizaba la misma del estado, y el
   * vídeo se quedaba apuntando a una URL muerta con un error 4 y la pantalla
   * congelada en «Preparando…». Le habría pasado a todo el mundo.
   *
   * Así, el segundo montaje crea una nueva y el estado se queda con la buena.
   */
  useEffect(() => {
    const nueva = URL.createObjectURL(fichero);
    setUrl(nueva);
    return () => URL.revokeObjectURL(nueva);
  }, [fichero]);

  /**
   * Se lanza solo al abrir. Es deliberado: si esto fuera un botón, la mayoría
   * subiría sin pulsarlo y el multistream se quedaría sin el dato del que
   * depende. Que falle es barato -- se pide a mano -- y que acierte ahorra el
   * paso entero.
   */
  const sondear = async () => {
    const el = video.current;
    if (!el) return;
    setLeyendo(true);
    setProblema(null);
    const resultado = await sondearReloj(el, setProgreso);
    setLeyendo(false);
    if (resultado.ok && resultado.offsetMs !== undefined) {
      setOffsetMs(resultado.offsetMs);
      setConfianza('ocr');
      // Aquí NO se contrasta con la hora del nombre del fichero, aunque
      // `horaDelNombre` sepa sacarla. Contrastar exige un instante absoluto
      // fiable contra el que comparar, y el único candidato -- `started_at` --
      // se escribe cuando alguien pulsa un botón, así que puede ir minutos
      // desviado del inicio real. Comparar contra eso daría discrepancias
      // constantes y acabaría enseñando avisos falsos. El nombre servirá
      // cuando haya un ancla de verdad; hasta entonces manda el cronómetro,
      // que ya viene verificado consigo mismo.
    } else {
      setProblema(resultado.motivo ?? 'No se pudo leer el cronómetro.');
    }
    el.currentTime = 0;
  };

  const alCargar = () => {
    const el = video.current;
    if (!el) return;
    setDuracion(el.duration);
    void sondear();
  };

  const recorteMs = (s: number | null) => (s === null ? null : Math.round(s * 1000));

  /**
   * El offset se guarda respecto al **fichero entero**, no al recorte. Si se
   * recorta por delante, lo que se sube empieza más tarde, así que el número
   * hay que correrlo -- si no, el multistream alinearía por donde estaba antes
   * de cortar.
   */
  const offsetFinal =
    offsetMs === null ? null : offsetMs + Math.round((entrada ?? 0) * 1000);

  return (
    <Sheet
      title="Antes de subir"
      subtitle={fichero.name}
      size="xl"
      onClose={onCancelar}
      footer={
        <div className="flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={onCancelar}
            className="px-4 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-sm"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={() =>
              onListo({
                recorteIniMs: recorteMs(entrada),
                recorteFinMs: recorteMs(salida),
                offsetMs: offsetFinal,
                confianza,
              })
            }
            className="px-4 rounded-lg bg-amber-600 hover:bg-amber-500 text-white text-sm font-medium"
          >
            Subir
          </button>
        </div>
      }
    >
      <div className="space-y-4">
        {url && (
          <video
            ref={video}
            src={url}
            controls
            playsInline
            onLoadedMetadata={alCargar}
            onTimeUpdate={(e) => setPosicion(e.currentTarget.currentTime)}
            // Un formato que el navegador no sabe decodificar --HEVC de un
            // iPhone reciente, AV1-- es un caso real, no una rareza. Sin esto
            // la pantalla se queda en «Preparando…» para siempre y parece
            // colgada.
            onError={() => {
              setIlegible(true);
              setLeyendo(false);
            }}
            className="w-full rounded-lg bg-black aspect-video"
          />
        )}

        {ilegible && (
          <p className="text-xs text-amber-400">
            Tu navegador no sabe reproducir este vídeo, así que aquí no se puede ni recortar
            ni leer el cronómetro. Puedes subirlo igual —el servidor lo convertirá— pero irá
            entero y sin sincronía.
          </p>
        )}

        {/* --- Sincronía --- */}
        {!ilegible && (
        <section className="rounded-lg border border-slate-800 bg-slate-900/40 p-3">
          <h4 className="text-xs font-semibold text-slate-300 mb-2">
            En qué momento de la guerra empieza
          </h4>

          {leyendo ? (
            <p className="text-xs text-slate-400 flex items-center gap-2">
              <i className="fa-solid fa-circle-notch fa-spin" aria-hidden="true" />
              {progreso}
            </p>
          ) : offsetMs !== null ? (
            <p className="text-xs text-emerald-400">
              {enPalabras(offsetFinal ?? offsetMs)}
              <span className="text-slate-500">
                {' · '}
                {confianza === 'ocr' ? 'leído del cronómetro y verificado' : 'lo dijiste tú'}
              </span>
            </p>
          ) : (
            <p className="text-xs text-amber-400">{problema}</p>
          )}

          {/*
            Siempre visible, no sólo cuando falla: el OCR puede acertar el
            formato y errar el número, y quien mira el vídeo lo ve al instante.
            Esconder la corrección detrás de un fallo declarado obligaría a
            subir algo que ya se sabe mal.
          */}
          <div className="mt-3 pt-3 border-t border-slate-800">
            <MarcaDeReloj
              posicionS={posicion}
              onAplicar={(ms) => {
                setOffsetMs(ms);
                setConfianza('manual');
                setProblema(null);
              }}
            />
          </div>
        </section>
        )}

        {/* --- Recorte --- */}
        {!ilegible && (
        <section className="rounded-lg border border-slate-800 bg-slate-900/40 p-3">
          <h4 className="text-xs font-semibold text-slate-300 mb-2">
            Recortar lo que sobra
            <span className="ml-2 font-normal text-slate-500">opcional</span>
          </h4>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setEntrada(posicion)}
              className="px-3 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs"
            >
              Empezar aquí ({reloj(posicion)})
            </button>
            <button
              type="button"
              onClick={() => setSalida(posicion)}
              className="px-3 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs"
            >
              Terminar aquí ({reloj(posicion)})
            </button>
            {(entrada !== null || salida !== null) && (
              <button
                type="button"
                onClick={() => {
                  setEntrada(null);
                  setSalida(null);
                }}
                className="tap-suelto text-[11px] text-slate-400 hover:text-slate-200 underline"
              >
                Quitar el recorte
              </button>
            )}
          </div>

          <p className="mt-2 text-[11px] text-slate-500">
            {entrada === null && salida === null ? (
              <>Se sube entero: {reloj(duracion)}.</>
            ) : (
              <>
                Se guardará de {reloj(entrada ?? 0)} a {reloj(salida ?? duracion)} —{' '}
                <span className="text-slate-400">
                  {reloj((salida ?? duracion) - (entrada ?? 0))}
                </span>{' '}
                de {reloj(duracion)}.
              </>
            )}
          </p>
          {/*
            El fichero sube entero pase lo que pase: cortar en el navegador un
            MP4 de 2 GB no es viable, y el corte se aplica en el servidor sobre
            el remux que ya se iba a hacer. Se dice para que nadie espere que
            recortar acorte la subida.
          */}
          <p className="mt-1 text-[11px] text-slate-600">
            El recorte se aplica al guardarlo, no a la subida: el fichero viaja entero.
          </p>
        </section>
        )}
      </div>
    </Sheet>
  );
};

export default PreparaVod;
