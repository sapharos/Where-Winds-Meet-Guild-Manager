
import React, { useState } from 'react';
import { Player, PlayerBuild, Role, MembershipStatus, GuildRank, WeaponSet, WarSide, WAR_SIDE_LABELS } from '../types';
import { ROLE_COLORS, ROLE_ICONS, PLATFORM_ICONS } from '../constants';
import Sheet from './Sheet';
import Grapa from './Grapa';

export const ROLE_NAMES: Record<Role, string> = {
  [Role.TANK]: 'Tanque',
  [Role.HEALER]: 'Sanador',
  [Role.DPS]: 'DPS',
};

// A member with no build reads as unpainted rather than as some arbitrary
// colour: the roster should show at a glance who has not been described yet.
const UNSET = '#475569';

/**
 * The colour of a build's main weapon, from the set it belongs to.
 *
 * Also reports when a build names weapons that no set contains any more, which
 * happens after the catalogue is renamed: the build keeps working but loses its
 * colours, and silently showing grey would look like nobody had a build.
 *
 * Devolvía dos colores, para pintar una rampa de la primera arma a la segunda.
 * Ya no hay rampas: el color de arma vive en una barra sólida y en los chips de
 * `ArmasDeBuild`, así que sólo se pide el de la principal.
 */
export function buildColour(
  build: PlayerBuild | undefined,
  sets: WeaponSet[],
): { from: string; orphaned: boolean } {
  const colourOf = (weapon?: string) =>
    weapon ? sets.find((s) => s.weapons.includes(weapon))?.color : undefined;

  const first = colourOf(build?.weapons[0]);
  return {
    from: first ?? UNSET,
    orphaned: Boolean(build?.weapons.length) && !first && !colourOf(build?.weapons[1]),
  };
}

/**
 * Las armas de una build: el color en un chip sólido y el nombre escrito al lado.
 *
 * Es la respuesta al color-como-dato de DIRECCION_VISUAL.md §2. `WeaponSet.color`
 * lo elige el usuario y vive en la base de datos, así que no hay forma de
 * garantizar su contraste: compuesto con opacidad -- `${color}66`, `${color}40`,
 * `${color}26` -- deja el texto sin fondo estable en oscuro y desaparece del
 * todo en claro. Aquí el color va sólido y pequeño, sobre la superficie del
 * tema, y **nunca es el único portador del dato**: quien no lo distingue lee el
 * nombre del arma igual.
 *
 * Vive aquí, con `buildColour`, porque la usan las tres fichas que dibujan una
 * build en pequeño -- el roster, la línea y el banquillo -- y tienen que decir
 * lo mismo de la misma forma.
 */
export const ArmasDeBuild: React.FC<{
  build?: PlayerBuild;
  weaponSets: WeaponSet[];
  /** Cuántas enseñar. Sin límite, todas. */
  limite?: number;
  /** Qué decir cuando no hay ninguna. */
  vacio?: string;
  className?: string;
}> = ({ build, weaponSets, limite, vacio = 'Sin build', className = '' }) => {
  const { orphaned } = buildColour(build, weaponSets);
  const armas = build?.weapons ?? [];
  const mostradas = limite === undefined ? armas : armas.slice(0, limite);

  return (
    <div className={`flex items-center gap-3 min-w-0 ${className}`}>
      {orphaned ? (
        <span
          className="text-meta text-amber-500 truncate"
          title={`Estas armas ya no existen en ningún conjunto: ${armas.join(', ')}`}
        >
          <i className="fa-solid fa-triangle-exclamation mr-1"></i>
          armas sin conjunto
        </span>
      ) : mostradas.length > 0 ? (
        mostradas.map((arma) => (
          <span key={arma} className="inline-flex items-center gap-1.5 min-w-0 text-meta text-slate-300">
            <span
              aria-hidden
              className="w-2.5 h-2.5 rounded-sm shrink-0"
              style={{
                backgroundColor:
                  weaponSets.find((s) => s.weapons.includes(arma))?.color ?? UNSET,
              }}
            />
            <span className="truncate">{arma}</span>
          </span>
        ))
      ) : (
        <span className="text-meta text-slate-500">{vacio}</span>
      )}
    </div>
  );
};

interface PlayerCardProps {
  player: Player;
  build?: PlayerBuild;
  weaponSets?: WeaponSet[];
  onEdit?: (p: Player) => void;
  onShowHistory?: (p: Player) => void;
  onShowBuilds?: (p: Player) => void;
  onToggleStarter?: (p: Player) => void;
  onCycleSide?: (p: Player) => void;
  onToggleActive?: (p: Player) => void;
  className?: string;
  ranks?: GuildRank[];
}

const PlayerCard: React.FC<PlayerCardProps> = ({
  player,
  build,
  weaponSets = [],
  onEdit,
  onShowHistory,
  onShowBuilds,
  onToggleStarter,
  onCycleSide,
  onToggleActive,
  className = '',
  ranks = [],
}) => {
  const rank = ranks.find((r) => r.id === player.rankId);
  const { from } = buildColour(build, weaponSets);
  const gone = player.isActive === false;
  const [menu, setMenu] = useState(false);
  /** Acuse de recibo del copiado, que dura lo que se tarda en verlo. */
  const [copiado, setCopiado] = useState(false);

  /**
   * Las acciones de la tarjeta, como datos.
   *
   * Eran seis botones de icono de 20x24 px separados 8, sin una sola etiqueta:
   * lo que hacía cada uno vivía en un `title`, que en un teléfono no existe. Y
   * el primero de los seis daba de baja a alguien, pegado al que marca titular,
   * que es el que más se pulsa.
   *
   * Ahora son una lista con su nombre escrito, cada una de 44 px de alto, con
   * la destructiva apartada al pie. Marcar titular pasa de un toque sobre un
   * objetivo que se falla a dos sobre uno que no.
   */
  const acciones = [
    // Copiar el UID va primero porque es lo que más se hace con una ficha
    // abierta: se pega en el buscador del juego para encontrar a alguien. Y
    // lleva el número escrito, así que también sirve para leerlo sin copiar --
    // en un teléfono, donde no hay `title` que valga, era invisible.
    player.gameUid && {
      id: 'uid',
      icono: copiado ? 'fa-check' : 'fa-copy',
      familia: 'fa-solid',
      tono: copiado ? 'text-emerald-400' : 'text-slate-400',
      texto: copiado ? 'UID copiado' : `Copiar UID · ${player.gameUid}`,
      // Sin cerrar la hoja: copiar no lleva a ninguna parte, y cerrarla se
      // llevaría por delante el acuse de recibo.
      cerrar: false,
      hacer: () => {
        void navigator.clipboard
          .writeText(player.gameUid as string)
          .then(() => {
            setCopiado(true);
            setTimeout(() => setCopiado(false), 1500);
          })
          .catch(() => setCopiado(false));
      },
    },
    onToggleStarter && !gone && {
      id: 'titular',
      icono: player.isStarter ? 'fa-star' : 'fa-star',
      familia: player.isStarter ? 'fa-solid' : 'fa-regular',
      // Titular es "te han fijado a la alineación", que es lo que significa la
      // grapa: va en su latón y no en el acento.
      tono: player.isStarter ? 'text-staple' : 'text-slate-400',
      texto: player.isStarter ? 'Quitar de titulares' : 'Marcar como titular',
      hacer: () => onToggleStarter(player),
    },
    onCycleSide && !gone && {
      id: 'bando',
      icono: player.warSide === 'defense' ? 'fa-shield' : 'fa-khanda',
      familia: 'fa-solid',
      tono:
        player.warSide === 'attack'
          ? 'text-red-400'
          : player.warSide === 'defense'
            ? 'text-sky-400'
            : 'text-slate-400',
      texto: player.warSide
        ? `${WAR_SIDE_LABELS[player.warSide as WarSide]} — cambiar`
        : 'Sin bando — poner en Ataque',
      hacer: () => onCycleSide(player),
    },
    onShowBuilds && {
      id: 'builds',
      icono: 'fa-hand-fist',
      familia: 'fa-solid',
      tono: 'text-slate-400',
      texto: 'Builds y armas',
      hacer: () => onShowBuilds(player),
    },
    onShowHistory && {
      id: 'historial',
      icono: 'fa-chart-line',
      familia: 'fa-solid',
      tono: 'text-slate-400',
      texto: 'Ver evolución',
      hacer: () => onShowHistory(player),
    },
    onEdit && {
      id: 'editar',
      icono: 'fa-pen-to-square',
      familia: 'fa-solid',
      tono: 'text-slate-400',
      texto: 'Editar miembro',
      hacer: () => onEdit(player),
    },
  ].filter(Boolean) as {
    id: string;
    icono: string;
    familia: string;
    tono: string;
    texto: string;
    /** Si la hoja se cierra al pulsarla. Casi todas sí; copiar, no. */
    cerrar?: boolean;
    hacer: () => void;
  }[];

  return (
    <>
    <div
      // min-w-0 en la raíz porque la tarjeta es hija de un grid, y un hijo de
      // grid no baja de su contenido mínimo salvo que se le diga. Sin esto, a
      // 320 px la tarjeta medía 467 y empujaba la página entera fuera de la
      // pantalla: el desborde no lo causaba el grid, lo causaba esto.
      //
      // overflow-hidden para que la tarjeta recorte sus propias barras de
      // color: son de 4 px de ancho y llevaban un radio de 16, que es el que
      // tiene ahora `rounded-lg`. Un radio mayor que el ancho no se puede
      // dibujar, así que el navegador lo aplastaba y las esquinas asomaban por
      // fuera del borde redondeado de la tarjeta. Recortadas por el padre
      // siguen exactamente la curva que tenga la tarjeta, ahora y después.
      //
      // Superficie sólida, no el lavado `${color}66` de antes: un tinte al 40%
      // deja el texto sin fondo estable -- costoso de leer para bastante gente
      // e invisible en tema claro. El color de las armas vive ahora en la barra
      // y en los chips de la tercera fila, sólidos y con el nombre del arma al
      // lado, para que el color nunca sea el único portador del dato.
      //
      // h-full: las tres filas son fijas, así que todas las tarjetas miden lo
      // mismo por construcción; esto sólo remata la fila del grid cuando el
      // vecino de al lado crece.
      className={`relative min-w-0 h-full overflow-hidden p-3 rounded-lg border bg-slate-900 transition-all ${
        gone
          ? 'border-slate-800 opacity-50 grayscale'
          : player.isStarter
            ? // Anillo a opacidad completa: al 35% era una insinuación, y la
              // queja fue literal -- no se notaba quién es titular.
              'border-staple shadow-[0_0_0_1px_rgb(var(--w-500))]'
            : 'border-slate-800'
      } ${className}`}
    >
      {/* La barra izquierda: el arma principal, en sólido. La secundaria ya no
          necesita borde propio: tiene su chip con nombre en la tercera fila. */}
      <span
        aria-hidden
        className="absolute left-0 top-0 bottom-0 w-1"
        style={{ backgroundColor: from }}
      />

      {/* Tres filas fijas: quién / sus datos / sus armas y bando. Antes había
          una pila de hasta siete insignias que envolvía en uno, dos o tres
          renglones según el miembro, y cada tarjeta medía una cosa. Ahora toda
          tarjeta dibuja las mismas filas -- vacías si hace falta -- y la
          cuadrícula queda pareja. */}
      <div className="pl-2 flex flex-col gap-1.5">
        <div className="flex items-center gap-3">
          <div className={`w-8 h-8 rounded flex items-center justify-center shrink-0 ${ROLE_COLORS[player.role]}`}>
            {ROLE_ICONS[player.role]}
          </div>
          <div className="min-w-0 grow">
            {/* min-w-0 en la fila y no un tope fijo en el nombre: con
                `max-w-[140px]` el nombre se recortaba siempre a 140 px aunque
                sobrara sitio, y aun así la fila no encogía por debajo de su
                contenido, así que a 320 px la tarjeta empujaba la página entera
                fuera de la pantalla. Ahora el nombre ocupa lo que hay. */}
            <div className="flex items-center gap-2 min-w-0">
              {/* La grapa delante del nombre: "te han fijado a la alineación".
                  El borde de latón solo no bastaba -- a una cuadrícula se la
                  recorre leyendo nombres, y la marca tiene que estar donde va
                  la mirada. */}
              {player.isStarter && !gone && (
                <span className="shrink-0 text-staple" title="Titular">
                  <Grapa />
                  <span className="sr-only">Titular</span>
                </span>
              )}
              <h4 className="font-bold text-slate-100 leading-tight truncate">{player.name}</h4>
              {player.platform && (
                <span className="text-slate-500 text-[10px] shrink-0" title={player.platform}>
                  {PLATFORM_ICONS[player.platform]}
                </span>
              )}
            </div>

            {/* Una sola línea de metadatos que se corta, no una pila de chips
                que envuelve. El rango conserva su color, pero como punto al
                lado del nombre: texto en color de usuario sobre la tarjeta no
                garantiza contraste; el punto no carga con la lectura. */}
            <p className="text-meta text-slate-400 truncate">
              {player.sect} · Nv.{player.level}
              {player.martialMastery !== undefined && (
                <span className="text-amber-400/90 tabular-nums" title="Maestría marcial, del último escaneo">
                  {' '}
                  · {player.martialMastery.toLocaleString('es')}
                </span>
              )}{' '}
              · {player.status === MembershipStatus.APPRENTICE ? 'Aprendiz' : 'Miembro'}
              {rank && (
                <span className="text-slate-300" title={`Rango: ${rank.name}`}>
                  {' '}
                  ·{' '}
                  <span
                    aria-hidden
                    className="inline-block w-2 h-2 rounded-full"
                    style={{ backgroundColor: rank.color }}
                  />{' '}
                  {rank.name}
                </span>
              )}
            </p>
          </div>

          {(acciones.length > 0 || onToggleActive) && (
            <button
              onClick={() => setMenu(true)}
              aria-label={`Acciones de ${player.name}`}
              aria-haspopup="dialog"
              className="shrink-0 -mr-1 min-h-tap min-w-tap flex items-center justify-center rounded-md text-slate-400 hover:text-amber-500 transition-colors duration-micro"
            >
              <i className="fa-solid fa-ellipsis-vertical"></i>
            </button>
          )}
        </div>

        {/* Las armas, con su color en un chip sólido y su nombre escrito al
            lado: quien no distingue los colores lee el arma igual. */}
        <div className="flex items-center gap-3 min-h-[20px]" title={build?.name}>
          <ArmasDeBuild build={build} weaponSets={weaponSets} limite={2} />

          {gone ? (
            // py de 3 y no 4: el borde ya pone sus 2px, y con 4 la etiqueta
            // medía 21 y las bajas eran 1px más altas que el resto.
            <span className="ml-auto shrink-0 text-[11px] leading-none px-1.5 py-[3px] rounded border border-slate-600 text-slate-400 uppercase font-bold tracking-tighter">
              fuera del gremio
            </span>
          ) : player.warSide ? (
            // Relleno sólido con texto blanco, no un tinte al 15%: los rellenos
            // 700 de las dos rampas pasan AA con blanco en los dos temas.
            <span
              className={`ml-auto shrink-0 text-[11px] leading-none px-1.5 py-1 rounded text-white uppercase font-bold tracking-tighter ${
                player.warSide === 'attack' ? 'bg-red-700' : 'bg-sky-700'
              }`}
            >
              {WAR_SIDE_LABELS[player.warSide as WarSide]}
            </span>
          ) : null}
        </div>
      </div>
    </div>

      {/* Fuera de la tarjeta: ahora la tarjeta recorta lo que hay dentro, y una
          hoja que cubre la pantalla no tiene nada que hacer dentro de una caja
          de 76 px de alto. */}
      {menu && (
        <Sheet
          title={player.name}
          subtitle={`${ROLE_NAMES[player.role]} · ${player.sect} · Nv.${player.level}`}
          size="sm"
          onClose={() => setMenu(false)}
        >
          <div className="flex flex-col gap-1">
            {acciones.map((accion) => (
              <button
                key={accion.id}
                onClick={() => {
                  accion.hacer();
                  if (accion.cerrar !== false) setMenu(false);
                }}
                className="min-h-tap flex items-center gap-3 px-3 -mx-1 rounded-md text-left text-slate-200 hover:bg-slate-800/60 transition-colors duration-micro"
              >
                <i className={`${accion.familia} ${accion.icono} ${accion.tono} w-5 text-center`}></i>
                {accion.texto}
              </button>
            ))}
          </div>

          {onToggleActive && (
            // Apartada, no escondida. Estaba a 8 px de la acción más frecuente
            // de la tarjeta, que es la peor vecindad posible para algo que
            // saca a alguien del gremio.
            <div className="mt-4 pt-3 border-t border-slate-800">
              <button
                onClick={() => {
                  onToggleActive(player);
                  setMenu(false);
                }}
                className={`w-full min-h-tap flex items-center gap-3 px-3 -mx-1 rounded-md text-left transition-colors duration-micro ${
                  gone
                    ? 'text-emerald-400 hover:bg-emerald-500/10'
                    : 'text-red-400 hover:bg-red-500/10'
                }`}
              >
                <i className={`fa-solid ${gone ? 'fa-user-check' : 'fa-user-slash'} w-5 text-center`}></i>
                {gone ? 'Readmitir en el gremio' : 'Marcar como fuera del gremio'}
              </button>
            </div>
          )}
        </Sheet>
      )}
    </>
  );
};

export default PlayerCard;
