import React, { useEffect, useState } from 'react';
import { api } from '../services/authService';

/**
 * What a member sees after Discord recognises them but this guild does not.
 *
 * They name themselves by their in-game account number, which the roster
 * already knows from the last sweep. Nothing is granted here: the claim waits
 * for a leader, because an account number is visible to every member in game
 * and so proves nothing on its own.
 */
const DiscordClaim: React.FC<{ onDone: () => void }> = ({ onDone }) => {
  const [discord, setDiscord] = useState<{ username: string } | null>(null);
  const [uid, setUid] = useState('');
  const [sent, setSent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<{ id: string; username: string }>('/auth/discord/pending')
      .then(setDiscord)
      .catch(() => setError('El registro caducó. Vuelve a entrar con Discord.'));
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { player } = await api<{ player: string }>('/auth/discord/claim', {
        method: 'POST',
        body: JSON.stringify({ uid }),
      });
      setSent(player);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo enviar la solicitud');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#0a0b0c] text-slate-200 flex items-center justify-center p-6">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center mb-8">
          <div className="w-16 h-16 bg-gradient-to-br from-amber-600 to-amber-900 rounded-lg flex items-center justify-center shadow-lg border border-amber-500/30 mb-4">
            <i className="fa-solid fa-wind text-3xl text-white"></i>
          </div>
          <h1 className="cinzel text-2xl font-bold tracking-widest text-white text-center leading-tight">
            ZONA ZERO
          </h1>
        </div>

        <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-6">
          {sent ? (
            <div className="text-center space-y-3">
              <i className="fa-solid fa-hourglass-half text-3xl text-amber-500"></i>
              <h2 className="cinzel text-xl font-bold text-amber-500">Solicitud enviada</h2>
              <p className="text-sm text-slate-400">
                Pediste enlazar tu Discord con <span className="text-slate-200 font-semibold">{sent}</span>.
                Un líder tiene que aprobarlo; cuando lo haga, entra otra vez con Discord y ya estarás dentro.
              </p>
              <button onClick={onDone} className="text-xs text-slate-500 hover:text-amber-500 transition-all">
                Volver al inicio
              </button>
            </div>
          ) : (
            <form onSubmit={submit} className="space-y-4">
              <div>
                <h2 className="cinzel text-xl font-bold text-amber-500">Enlaza tu personaje</h2>
                <p className="text-xs text-slate-500 mt-1">
                  {discord ? (
                    <>
                      Discord te reconoce como{' '}
                      <span className="text-slate-300 font-semibold">{discord.username}</span>. Falta decirnos
                      quién eres dentro del juego.
                    </>
                  ) : (
                    'Comprobando tu sesión de Discord...'
                  )}
                </p>
              </div>

              <div>
                <label className="block text-xs uppercase tracking-wider text-slate-500 mb-1">
                  Tu UID del juego
                </label>
                <input
                  type="text"
                  inputMode="numeric"
                  required
                  autoFocus
                  value={uid}
                  placeholder="1024545703"
                  onChange={(e) => setUid(e.target.value.replace(/[^0-9]/g, ''))}
                  className="w-full bg-slate-950 border border-slate-800 rounded p-2 text-sm font-mono outline-none focus:ring-1 focus:ring-amber-500"
                />
                <p className="text-[10px] text-slate-600 mt-1">
                  Ábrelo en el juego pulsando tu propio retrato en la lista del gremio.
                </p>
              </div>

              {error && (
                <div className="text-xs text-red-300 bg-red-950/60 border border-red-900 rounded p-2 flex items-center gap-2">
                  <i className="fa-solid fa-triangle-exclamation"></i>
                  {error}
                </div>
              )}

              <button
                type="submit"
                disabled={busy || !discord}
                className="w-full bg-amber-600 hover:bg-amber-500 disabled:bg-slate-700 disabled:cursor-not-allowed text-white font-bold py-2 px-4 rounded transition-all flex items-center justify-center gap-2"
              >
                {busy ? <i className="fa-solid fa-circle-notch fa-spin"></i> : <i className="fa-solid fa-link"></i>}
                Solicitar acceso
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};

export default DiscordClaim;
