import React, { useState } from 'react';

interface Props {
  onLogin: (username: string, password: string) => Promise<void>;
}

const LoginScreen: React.FC<Props> = ({ onLogin }) => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await onLogin(username, password);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign in failed');
      setPassword('');
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
            WHERE WINDS MEET
          </h1>
          <p className="text-[10px] uppercase tracking-[0.2em] text-amber-500 font-bold mt-1">
            Strategic Command
          </p>
        </div>

        <form
          onSubmit={handleSubmit}
          className="bg-slate-900/60 border border-slate-800 rounded-xl p-6 space-y-4"
        >
          <div>
            <label className="block text-xs uppercase tracking-wider text-slate-500 mb-1">Usuario</label>
            <input
              type="text"
              required
              autoFocus
              autoComplete="username"
              className="w-full bg-slate-950 border border-slate-800 rounded p-2 text-sm outline-none focus:ring-1 focus:ring-amber-500"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
            />
          </div>

          <div>
            <label className="block text-xs uppercase tracking-wider text-slate-500 mb-1">Contraseña</label>
            <input
              type="password"
              required
              autoComplete="current-password"
              className="w-full bg-slate-950 border border-slate-800 rounded p-2 text-sm outline-none focus:ring-1 focus:ring-amber-500"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>

          {error && (
            <div className="text-xs text-red-300 bg-red-950/60 border border-red-900 rounded p-2 flex items-center gap-2">
              <i className="fa-solid fa-triangle-exclamation"></i>
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={busy}
            className="w-full bg-amber-600 hover:bg-amber-500 disabled:bg-slate-700 disabled:cursor-not-allowed text-white font-bold py-2 px-4 rounded transition-all flex items-center justify-center gap-2"
          >
            {busy ? <i className="fa-solid fa-circle-notch fa-spin"></i> : <i className="fa-solid fa-right-to-bracket"></i>}
            Entrar
          </button>
        </form>
      </div>
    </div>
  );
};

export default LoginScreen;
