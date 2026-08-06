
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Player, GuildWarSession, Lane, TacticalGroup, MembershipStatus, GuildRank, ROLE_LABELS, PlayerBuild, WeaponSet, WarSide } from './types';
import { storageService } from './services/storageService';
import { authService, api, ApiError, Session } from './services/authService';
import { DEFAULT_GROUPS } from './constants';
import MemberManager from './components/MemberManager';
import WarBoard from './components/WarBoard';
import LoginScreen from './components/LoginScreen';
import DiscordClaim from './components/DiscordClaim';
import MyProfile from './components/MyProfile';
import AdminPanel from './components/AdminPanel';
import MemberHistory from './components/MemberHistory';
import BuildEditor from './components/BuildEditor';
import ThemeToggle from './components/ThemeToggle';
import InstalarApp from './components/InstalarApp';
import { Bloque, Tarjetas } from './components/Esqueleto';

const App: React.FC = () => {
  const [session, setSession] = useState<Session | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [activeTab, setActiveTab] = useState<'me' | 'roster' | 'war-room' | 'admin'>('roster');
  const [haciaAtras, setHaciaAtras] = useState(false);
  const [historyFor, setHistoryFor] = useState<Player | null>(null);
  const [buildsFor, setBuildsFor] = useState<Player | null>(null);
  const [players, setPlayers] = useState<Player[]>([]);
  const [sessions, setSessions] = useState<GuildWarSession[]>([]);
  const [ranks, setRanks] = useState<GuildRank[]>([]);
  const [builds, setBuilds] = useState<PlayerBuild[]>([]);
  const [weaponSets, setWeaponSets] = useState<WeaponSet[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);

  /**
   * Re-read the weapon sets after somebody edits them.
   *
   * They are loaded once with everything else, which was fine while a set was
   * only a name and a crest. Now a set also carries what it is expected to
   * produce, and the impact score is worked out from that every time it is
   * drawn -- so an allowance changed in Administración has to reach the rest
   * of the app, or the tables go on scoring against the old one until a
   * reload and it reads as though the setting did nothing.
   */
  const reloadWeaponSets = () => {
    void api<WeaponSet[]>('/weapon-sets')
      .then(setWeaponSets)
      .catch(() => undefined);
  };
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const can = useCallback(
    (permission: string) => session?.permissions.includes(permission) ?? false,
    [session],
  );

  const rosterLocked = !can('roster.edit');
  const warLocked = !can('war.edit');

  // Surfaces a write failure instead of letting the UI show state the server
  // never accepted. An expired session drops back to the login screen rather
  // than reporting a save error the user cannot act on.
  const persist = useCallback((op: Promise<unknown>) => {
    op.then(() => setSaveError(null)).catch((err) => {
      if (err instanceof ApiError && err.status === 401) {
        setSession(null);
        return;
      }
      console.error('Save failed', err);
      // Saying "check the connection" when the server answered and refused
      // sends the reader looking in the wrong place, so its own words are
      // shown when it gave any.
      setSaveError(
        err instanceof ApiError
          ? err.status === 403
            ? 'Tu rol no permite ese cambio.'
            : `No se pudo guardar: ${err.message}`
          : 'No se pudo guardar. Revisa la conexión con el servidor.',
      );
    });
  }, []);

  /**
   * Reads everything back from the server.
   *
   * `quiet` is for reloading after a change the user made themselves. Without
   * it the spinner replaces the page, React throws away whatever is mounted,
   * and the roster comes back with its filters and its search box blank -- so
   * saving one build costs you the list you had narrowed down to. The data is
   * already on screen and still valid; only the reason to blank it is missing.
   */
  const loadAllData = useCallback(async ({ quiet = false }: { quiet?: boolean } = {}) => {
    if (!quiet) setIsLoading(true);
    try {
      const { players: loadedPlayers, sessions: loadedSessions, ranks: loadedRanks } =
        await storageService.getState();

      setPlayers(loadedPlayers);
      setSessions(loadedSessions);

      // Builds and their weapon sets paint the roster cards, so they load with
      // everything else. A failure here must not hide the roster itself.
      void Promise.all([
        api<PlayerBuild[]>('/builds').catch(() => []),
        api<WeaponSet[]>('/weapon-sets').catch(() => []),
      ]).then(([loadedBuilds, loadedSets]) => {
        setBuilds(loadedBuilds);
        setWeaponSets(loadedSets);
      });

      // The first visitor to an empty guild seeds the defaults, but only if
      // their role is allowed to write them -- a plain member signing in first
      // should not be met with a permission error.
      if (loadedRanks.length === 0) {
        const defaultRanks: GuildRank[] = [
          { id: 'rank-leader', name: 'Guild Leader', color: '#fbbf24' },
          { id: 'rank-manager', name: 'Guild Manager', color: '#60a5fa' },
        ];
        setRanks(defaultRanks);
        if (can('ranks.manage')) await storageService.saveRanks(defaultRanks);
      } else {
        setRanks(loadedRanks);
      }

      if (loadedSessions.length > 0) {
        setActiveSessionId(loadedSessions[0].id);
      } else {
        const newSession: GuildWarSession = {
          id: 'initial-session',
          name: 'Operation: Wind Guard',
          date: new Date().toISOString(),
          assignments: [],
          groups: [...DEFAULT_GROUPS]
        };
        setSessions([newSession]);
        setActiveSessionId(newSession.id);
        if (can('war.edit')) await storageService.saveSessions([newSession]);
      }
      setLoadError(null);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setSession(null);
        return;
      }
      console.error('Load failed', err);
      setLoadError('No se pudo contactar con el servidor. Lo que ves puede estar incompleto.');
    } finally {
      setIsLoading(false);
    }
  }, [can]);

  // Restores an existing session on load; the cookie is httpOnly, so only the
  // server can tell us whether one is still valid.
  useEffect(() => {
    authService
      .me()
      .then(setSession)
      .catch(() => setSession(null))
      .finally(() => setAuthChecked(true));
  }, []);

  useEffect(() => {
    if (session) void loadAllData();
  }, [session, loadAllData]);

  // A member arrives asking how they are doing, not who else is in the guild,
  // so the personal page opens when there is one to open.
  useEffect(() => {
    if (session?.user.playerId) setActiveTab('me');
  }, [session?.user.playerId]);

  // La colaboración por PeerJS vivió aquí hasta agosto de 2026. Era de antes de
  // que existiera el servidor: dos navegadores compartían estado de tú a tú
  // porque no había otro sitio donde compartirlo. Con la API como única fuente
  // de verdad se quitó entero, botones incluidos, a petición del dueño.

  const handleAddPlayer = (p: Player) => {
    if (rosterLocked) return;
    const updated = [...players, p];
    setPlayers(updated);
    persist(storageService.savePlayers(updated));
  };

  const handleUpdatePlayer = (p: Player) => {
    if (rosterLocked) return;
    const updated = players.map(prev => prev.id === p.id ? p : prev);
    setPlayers(updated);
    persist(storageService.savePlayers(updated));
  };

  // Nobody is deleted from the roster: leaving the guild is a change of state,
  // not the end of a record. Someone marked as gone keeps their scans, their
  // builds and the wars they fought, which is the whole point of keeping them --
  // and they can come back without arriving as a stranger.

  // El alta y la baja de rangos vivieron aquí hasta agosto de 2026, colgadas
  // del formulario de miembro. Quién es líder u oficial lo dicen ahora los
  // roles del sistema de usuarios; el catálogo de rangos sólo se lee, para
  // pintar el que un miembro ya tenga puesto.

  const handleExport = () => storageService.exportAllData();
  const handleImportClick = () => fileInputRef.current?.click();

  const handleFileImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!can('data.import')) return;
    const file = e.target.files?.[0];
    if (file) {
      const success = await storageService.importAllData(file);
      if (success) {
        await loadAllData();
        alert("Guild data successfully imported!");
      } else {
        alert("That file could not be imported.");
      }
    }
    if (e.target) e.target.value = '';
  };

  const setFlags = (p: Player, flags: { isStarter?: boolean; warSide?: WarSide | null; isActive?: boolean }) => {
    if (rosterLocked) return;

    // Shown immediately so the roster stays responsive, but put back if the
    // save fails: a card that keeps a change the server rejected is worse than
    // a slow one, because the work looks done until the page is reloaded.
    const before = { isStarter: p.isStarter, warSide: p.warSide, isActive: p.isActive };
    setPlayers((prev) => prev.map((x) => (x.id === p.id ? { ...x, ...flags } : x)));

    persist(
      api(`/players/${p.id}/flags`, { method: 'PATCH', body: JSON.stringify(flags) }).catch((err) => {
        setPlayers((prev) => prev.map((x) => (x.id === p.id ? { ...x, ...before } : x)));
        throw err;
      }),
    );
  };

  const handleToggleStarter = (p: Player) => setFlags(p, { isStarter: !p.isStarter });

  const handleToggleActive = (p: Player) => {
    const leaving = p.isActive !== false;
    if (leaving && !window.confirm(
      `¿Marcar a ${p.name} como fuera del gremio? Perderá el acceso a la web, pero su historial se conserva por si vuelve.`,
    )) return;
    // Leaving takes them out of the line-up too, which the server also enforces.
    setFlags(p, leaving ? { isActive: false, isStarter: false } : { isActive: true });
  };

  // Undecided is a state worth returning to, so the button cycles through it
  // rather than only swapping between the two sides.
  const handleCycleSide = (p: Player) =>
    setFlags(p, { warSide: p.warSide === 'attack' ? 'defense' : p.warSide === 'defense' ? null : 'attack' });

  const handleLogin = async (username: string, password: string) => {
    setSession(await authService.login(username, password));
  };

  const handleLogout = async () => {
    await authService.logout().catch(() => undefined);
    setSession(null);
    setPlayers([]);
    setSessions([]);
    setRanks([]);
    setActiveTab('roster');
  };

  const handleChangePassword = async () => {
    const currentPassword = window.prompt('Contraseña actual:');
    if (!currentPassword) return;
    const newPassword = window.prompt('Nueva contraseña (mínimo 8 caracteres):');
    if (!newPassword) return;
    try {
      await authService.changePassword(currentPassword, newPassword);
      alert('Contraseña actualizada.');
    } catch (err) {
      alert(err instanceof Error ? err.message : 'No se pudo cambiar la contraseña.');
    }
  };

  const activeSession = sessions.find(s => s.id === activeSessionId);
  const myPlayer = players.find((p) => p.id === session?.user.playerId);
  // Escaneo dejó de ser una pestaña: importar un barrido es una tarea
  // administrativa y vive dentro de Administración, así que quien puede
  // escanear necesita llegar a esa sección aunque no gestione nada más.
  const canSeeAdmin =
    can('users.manage') || can('permissions.manage') || can('builds.manage') || can('roster.edit');

  // The tabs as data rather than five near-identical blocks of markup: adding
  // one should not mean copying a class list and hoping it still matches.
  // `corto` es la etiqueta de la barra inferior, donde hay cuatro columnas y
  // "Sala de Guerra" en dos líneas rompe la fila.
  const tabs = [
    { id: 'roster' as const, label: 'Roster', corto: 'Roster', icon: 'fa-users', show: true },
    { id: 'me' as const, label: 'Mi perfil', corto: 'Perfil', icon: 'fa-user', show: Boolean(myPlayer) },
    { id: 'war-room' as const, label: 'Sala de Guerra', corto: 'Guerra', icon: 'fa-chess-knight', show: true },
    { id: 'admin' as const, label: 'Administración', corto: 'Admin', icon: 'fa-user-shield', show: canSeeAdmin },
  ].filter((t) => t.show);

  /**
   * Por qué lado entra la pantalla nueva.
   *
   * Moverse a la derecha en la barra trae el contenido desde la derecha, y
   * volver lo trae desde la izquierda. Es la única señal de sentido que tiene
   * una barra donde los cuatro destinos parecen igual de lejos.
   *
   * Se decide al pulsar y no al pintar. La primera versión guardaba la pestaña
   * anterior en un ref y lo actualizaba durante el render, y siempre salía
   * "adelante": en desarrollo React renderiza dos veces, y en la segunda el ref
   * ya valía la pestaña nueva, así que la diferencia era cero. Comparar dos
   * cosas mientras una de ellas se está escribiendo no funciona.
   */
  const irA = (destino: typeof activeTab) => {
    const desde = tabs.findIndex((t) => t.id === activeTab);
    const hasta = tabs.findIndex((t) => t.id === destino);
    setHaciaAtras(hasta < desde);
    setActiveTab(destino);
  };

  const handleUpdateSession = (updatedSession: GuildWarSession) => {
    if (warLocked) return;
    const updated = sessions.map(s => s.id === updatedSession.id ? updatedSession : s);
    setSessions(updated);
    persist(storageService.saveSessions(updated));
  };

  if (!authChecked) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-500 flex items-center justify-center gap-3">
        <i className="fa-solid fa-circle-notch fa-spin"></i>
        Cargando...
      </div>
    );
  }

  if (!session) {
    // Discord sends them back here with this marker when it recognised them but
    // this guild has no account for them yet.
    if (new URLSearchParams(window.location.search).has('registro')) {
      return <DiscordClaim onDone={() => { window.location.search = ''; }} />;
    }
    return <LoginScreen onLogin={handleLogin} />;
  }

  return (
    <div className="recorta-rutas min-h-screen bg-slate-950 text-slate-200">
      {/* pad-safe-top: pegada arriba y sin ella, la fila de identidad se mete
          bajo el recorte de la pantalla en cuanto el teléfono tiene uno. */}
      <header className="border-b border-slate-800 bg-slate-900/80 backdrop-blur-md sticky top-0 z-50 pad-safe-top">
        {/* Identity and account on one line, navigation on its own below it.
            Sharing a line is what squeezed the labels into three lines each. */}
        <div className="max-w-[1600px] mx-auto px-4 sm:px-6 pt-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 shrink-0 bg-gradient-to-br from-amber-600 to-amber-900 rounded-lg flex items-center justify-center shadow-lg border border-amber-500/30">
              <i className="fa-solid fa-wind text-xl text-white"></i>
            </div>
            <div className="min-w-0">
              <h1 className="cinzel text-lg sm:text-xl font-bold tracking-widest text-slate-100 leading-none truncate">
                ZONA ZERO
              </h1>
              <p className="hidden sm:block mt-0.5 text-[10px] uppercase tracking-[0.2em] text-amber-500 font-bold">
                Mando Estratégico
              </p>
            </div>
          </div>

          {/*
            Una sola fila de herramientas, alineadas al mismo alto.

            Aquí en medio vivían los botones de Transmitir y Conectarme de la
            colaboración P2P, apilados en dos pisos que doblaban la altura de la
            cabecera y partían el resto en islas. La colaboración se quitó
            entera -- era de antes de que existiera el servidor -- así que la
            fila queda: exportar/importar, quién eres, tema, llave y salida.
          */}
          <div className="flex items-center gap-2 sm:gap-3 shrink-0">
            {/* Below large screens the tools live behind one button. A native
                details element needs no state and closes itself. */}
            <details className="lg:hidden relative">
              <summary
                aria-label="Más herramientas"
                className="list-none cursor-pointer p-2 rounded-lg bg-slate-950 border border-slate-800 text-slate-400 hover:text-amber-500 transition-all"
              >
                <i className="fa-solid fa-ellipsis"></i>
              </summary>
              <div className="absolute right-0 mt-2 w-60 bg-slate-900 border border-slate-800 rounded-lg shadow-2xl p-3 space-y-3 z-50">
                <div>
                  <p className="text-[10px] uppercase tracking-wider text-slate-500 mb-1.5">Tema</p>
                  <ThemeToggle />
                </div>
                <div className="flex gap-2">
                  {can('data.export') && (
                    <button
                      onClick={handleExport}
                      className="flex-1 text-xs py-2 rounded border border-slate-800 text-slate-400 hover:text-amber-500 transition-all"
                    >
                      <i className="fa-solid fa-download mr-1.5"></i>
                      Exportar
                    </button>
                  )}
                  {can('data.import') && (
                    <button
                      onClick={handleImportClick}
                      className="flex-1 text-xs py-2 rounded border border-slate-800 text-slate-400 hover:text-amber-500 transition-all"
                    >
                      <i className="fa-solid fa-upload mr-1.5"></i>
                      Importar
                    </button>
                  )}
                </div>
                {/* Quien entró sin instalar desde la pantalla de acceso tiene
                    aquí la segunda oportunidad; el componente se retira solo
                    cuando ya corre instalada o la plataforma no ofrece nada. */}
                <InstalarApp />
              </div>
            </details>

            {(can('data.export') || can('data.import')) && (
              <div className="hidden lg:flex bg-slate-950 p-1 rounded-lg border border-slate-800">
                {can('data.export') && (
                  <button
                    onClick={handleExport}
                    className="p-2 text-slate-400 hover:text-amber-500 hover:bg-slate-900 rounded transition-all"
                    title="Exportar los datos del gremio"
                  >
                    <i className="fa-solid fa-download"></i>
                  </button>
                )}
                {can('data.import') && (
                  <button
                    onClick={handleImportClick}
                    className="p-2 text-slate-400 hover:text-amber-500 hover:bg-slate-900 rounded transition-all"
                    title="Importar datos del gremio"
                  >
                    <i className="fa-solid fa-upload"></i>
                  </button>
                )}
              </div>
            )}
            <input type="file" ref={fileInputRef} className="hidden" accept=".json" onChange={handleFileImport} />

            <div className="flex items-center gap-2">
              <div className="text-right leading-tight hidden md:block">
                <div className="text-sm font-semibold text-slate-100">{session.user.username}</div>
                <div className="text-[10px] uppercase tracking-wider text-amber-500 font-bold">
                  {ROLE_LABELS[session.user.role] ?? session.user.role}
                </div>
              </div>
              {/* Tres botones de 44px no caben junto al nombre del gremio en un
                  teléfono: metidos aquí dejaban "ZONA ZERO" en "Z.". Abajo de
                  lg viven en el mismo menú que el resto de herramientas, que es
                  lo que ya hacían la colaboración y la importación. */}
              <div className="hidden lg:block">
                <ThemeToggle />
              </div>
              <div className="flex bg-slate-950 p-1 rounded-lg border border-slate-800">
                <button
                  onClick={handleChangePassword}
                  className="p-2 text-slate-400 hover:text-amber-500 hover:bg-slate-900 rounded transition-all"
                  title="Cambiar contraseña"
                >
                  <i className="fa-solid fa-key"></i>
                </button>
                <button
                  onClick={handleLogout}
                  className="p-2 text-slate-400 hover:text-amber-500 hover:bg-slate-900 rounded transition-all"
                  title="Cerrar sesión"
                >
                  <i className="fa-solid fa-right-from-bracket"></i>
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* En escritorio las pestañas siguen donde estaban. En el teléfono se
            van abajo (ver el <nav> del final): arriba estaban fuera del alcance
            del pulgar, se salían de la pantalla y había que arrastrarlas de
            lado para llegar a la última. */}
        <nav className="hidden sm:block max-w-[1600px] mx-auto px-6 py-3 overflow-x-auto no-bar">
          <div className="flex gap-1 w-max mx-auto bg-slate-950 p-1 rounded-lg border border-slate-800">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => irA(tab.id)}
                className={`px-5 py-2 rounded-md text-sm font-semibold transition-all flex items-center gap-2 whitespace-nowrap ${
                  activeTab === tab.id
                    ? 'bg-amber-700 text-white shadow-lg'
                    : 'text-slate-500 hover:text-slate-300'
                }`}
              >
                <i className={`fa-solid ${tab.icon}`}></i>
                {tab.label}
              </button>
            ))}
          </div>
        </nav>
      </header>

      {(loadError || saveError) && (
        <div className="bg-red-950/80 border-b border-red-800 text-red-200 text-sm px-6 py-2 flex items-center gap-3">
          <i className="fa-solid fa-triangle-exclamation"></i>
          <span>{loadError || saveError}</span>
        </div>
      )}

      {/* 16 px de margen en el teléfono y 24 a partir de sm. Con 24 fijos se
          perdían 48 de los 375, el 12,8% del ancho, en no dibujar nada. */}
      {/* `key` en la pestaña para que la animación vuelva a correr en cada
          cambio: sin ella React reutiliza el nodo y la clase no dispara nada. */}
      <main
        key={activeTab}
        className={`max-w-[1600px] mx-auto p-4 sm:p-6 ${haciaAtras ? 'ruta-atras' : 'ruta-adelante'}`}
      >
        {isLoading ? (
          // Era una rueda centrada en una caja de 384 px de alto que después se
          // sustituía por contenido de otra altura, así que la página pegaba un
          // salto justo cuando el lector empezaba a leerla. El esqueleto ocupa
          // el sitio que va a ocupar el roster y dice qué va a salir.
          <div className="space-y-5" role="status" aria-label="Cargando los datos del gremio">
            <Bloque alto="h-[188px]" className="rounded-xl" />
            <Tarjetas cuantas={6} />
          </div>
        ) : activeTab === 'me' ? (
          myPlayer ? (
            <MyProfile
              player={myPlayer}
              weaponSets={weaponSets}
              onEditBuilds={() => setBuildsFor(myPlayer)}
            />
          ) : (
            <p className="text-sm text-slate-500 text-center py-12">
              Tu cuenta todavía no está enlazada a un miembro del roster.
            </p>
          )
        ) : activeTab === 'admin' ? (
          // quiet: el escaneo lo acaba de guardar quien está mirando; el
          // spinner de página desmontaría el panel y con él su resumen de
          // reactivados y bajas, que es lo único que queda por leer.
          <AdminPanel
            currentUser={session.user}
            canManageUsers={can('users.manage')}
            canManagePermissions={can('permissions.manage')}
            canManageBuilds={can('builds.manage')}
            canScan={can('roster.edit')}
            players={players}
            onScanImported={() => void loadAllData({ quiet: true })}
            onWeaponSetsChanged={reloadWeaponSets}
          />
        ) : activeTab === 'roster' ? (
          <MemberManager
            players={players}
            ranks={ranks}
            isViewer={rosterLocked}
            onAdd={handleAddPlayer}
            onUpdate={handleUpdatePlayer}
            onShowHistory={setHistoryFor}
            onShowBuilds={setBuildsFor}
            onToggleStarter={handleToggleStarter}
            onCycleSide={handleCycleSide}
            onToggleActive={handleToggleActive}
            builds={builds}
            weaponSets={weaponSets}
          />
        ) : (
          <WarBoard
            players={players}
            builds={builds}
            weaponSets={weaponSets}
            canEdit={!warLocked}
            canVoice={can('war.voice')}
          />
        )}
      </main>

      {historyFor && <MemberHistory player={historyFor} onClose={() => setHistoryFor(null)} />}

      {buildsFor && (
        <BuildEditor
          player={buildsFor}
          canEdit={can('builds.manage') || buildsFor.id === session.user.playerId}
          onClose={() => setBuildsFor(null)}
          onSaved={() => void loadAllData({ quiet: true })}
        />
      )}

      {/*
        La navegación, abajo y sólo en el teléfono.

        Arriba estaba en el peor sitio posible: fuera del alcance del pulgar, y
        tan ancha que la última pestaña quedaba fuera de la pantalla y había que
        arrastrarla de lado para encontrarla. Aquí cada destino tiene su columna,
        se ven todos a la vez, y están donde ya está la mano.

        Los mismos destinos y en el mismo orden que arriba: cambia dónde está la
        barra, no el mapa.
      */}
      {/* `nav-inferior` la aparta cuando sale el teclado (regla en tokens.css).
          Se hace en CSS y no con estado: la altura del teclado cambia muchas
          veces por segundo mientras se abre, y volver a renderizar la
          aplicación entera en cada paso es la forma más cara posible de mover
          una barra 76 px. */}
      <nav
        aria-label="Secciones"
        className="nav-inferior sm:hidden fixed bottom-0 inset-x-0 z-40 border-t border-slate-800 bg-slate-900/95 backdrop-blur-md pb-safe-b"
      >
        <div className="flex">
          {tabs.map((tab) => {
            const aqui = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => irA(tab.id)}
                aria-current={aqui ? 'page' : undefined}
                className={`flex-1 min-w-0 min-h-tap flex flex-col items-center justify-center gap-0.5 pt-2 pb-1.5 transition-colors duration-micro ${
                  aqui ? 'text-amber-500' : 'text-slate-500'
                }`}
              >
                <i className={`fa-solid ${tab.icon} text-lg`}></i>
                <span className="text-[11px] font-semibold tracking-wide">{tab.corto}</span>
                {/* 锔钉: la grapa marca dónde estás sujeto. */}
                <svg
                  aria-hidden
                  width="26"
                  height="5"
                  viewBox="0 0 34 7"
                  className={`transition-opacity duration-micro ${aqui ? 'opacity-100' : 'opacity-0'}`}
                >
                  <rect x="4" y="2" width="26" height="2.6" rx="1.3" fill="currentColor" />
                  <circle cx="4" cy="3.3" r="3.2" fill="currentColor" />
                  <circle cx="30" cy="3.3" r="3.2" fill="currentColor" />
                </svg>
              </button>
            );
          })}
        </div>
      </nav>

      {/* El hueco que ocupa la barra fija, para que no tape el último elemento
          de ninguna pantalla. */}
      <div className="sm:hidden h-[76px] pb-safe-b" aria-hidden />
    </div>
  );
};

export default App;
