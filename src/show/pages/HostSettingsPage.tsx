import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { Mic, Save, Zap, ArrowLeft, RefreshCw } from 'lucide-react';
import { fetchHostConfig, upsertHostConfig, triggerHostAction, fetchAgents } from '../api/client';
import type { Agent, HostAgentConfig } from '../api/types';
import { useAuth } from '../context/AuthContext';

const modelOptions = [
  { value: 'openai/gpt-4o', label: 'GPT-4o (OpenAI)' },
  { value: 'openai/gpt-4o-mini', label: 'GPT-4o Mini' },
  { value: 'anthropic/claude-sonnet-4', label: 'Claude Sonnet 4 (Anthropic)' },
  { value: 'anthropic/claude-3.5-sonnet', label: 'Claude 3.5 Sonnet' },
  { value: 'anthropic/claude-3-haiku', label: 'Claude 3 Haiku' },
  { value: 'google/gemini-pro-1.5', label: 'Gemini Pro 1.5' },
  { value: 'google/gemini-3-flash-preview', label: 'Gemini 3 Flash Preview (Google)' },
  { value: 'meta-llama/llama-3.1-70b-instruct', label: 'Llama 3.1 70B' },
  { value: 'mistralai/mistral-small-creative', label: 'Mistral Small Creative (Mistral)' },
  { value: 'deepseek/deepseek-v3.2', label: 'DeepSeek V3.2' },
  { value: 'qwen/qwen3.5-plus-02-15', label: 'Qwen 3.5 Plus (Alibaba)' },
  { value: 'moonshotai/kimi-k2.5', label: 'Kimi K2.5 (Moonshot)' },
  { value: 'x-ai/grok-4.1-fast', label: 'Grok 4.1 Fast (xAI)' },
];

export function HostSettingsPage() {
  const { seasonId } = useParams();
  const sid = seasonId!;
  const { profile } = useAuth();
  const [agents, setAgents] = useState<Agent[]>([]);
  const [config, setConfig] = useState<Partial<HostAgentConfig>>({
    name: 'Le Maitre du Jeu',
    avatar_url: 'https://images.pexels.com/photos/8721318/pexels-photo-8721318.jpeg?auto=compress&cs=tinysrgb&w=200',
    openrouter_api_key: '',
    openrouter_model: 'openai/gpt-4o',
    system_prompt: '',
    personality: 'Charismatique, dramatique, imprevisible. Il adore creer du suspense et provoquer des rebondissements.',
    enabled: false,
  });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [actionBusy, setActionBusy] = useState<string | null>(null);
  const [actionResult, setActionResult] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      fetchHostConfig().then((c) => {
        if (c) setConfig(c);
      }),
      fetchAgents(sid).then(setAgents),
    ])
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [sid]);

  async function handleSave() {
    setSaving(true);
    setSaved(false);
    setErr(null);
    try {
      await upsertHostConfig(config);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Erreur de sauvegarde');
    } finally {
      setSaving(false);
    }
  }

  async function handleAction(action: 'commentary' | 'day_recap' | 'provoke', targetName?: string) {
    setActionBusy(action);
    setActionResult(null);
    setErr(null);
    try {
      const result = await triggerHostAction(sid, action, targetName);
      setActionResult(result.message);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Erreur');
    } finally {
      setActionBusy(null);
    }
  }

  if (profile?.role !== 'admin') {
    return (
      <div className="text-center py-20 text-white/40 text-sm">
        Acces reserve aux administrateurs.
      </div>
    );
  }

  if (loading) {
    return (
      <div className="space-y-4">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="skeleton h-20 rounded-2xl" />
        ))}
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <Link
          to={`/show/${sid}/live`}
          className="p-2 rounded-lg border border-white/10 bg-white/5 hover:bg-white/10 text-white/50 hover:text-white transition-all"
        >
          <ArrowLeft className="w-4 h-4" />
        </Link>
        <div>
          <h1 className="text-xl font-black text-white flex items-center gap-2">
            <Mic className="w-5 h-5 text-cyan-400" />
            Presentateur IA
          </h1>
          <p className="text-xs text-white/40 mt-0.5">
            Configure l'agent animateur/juge de la saison
          </p>
        </div>
      </div>

      <div className="border border-white/[0.08] rounded-2xl p-5 space-y-5 bg-white/[0.02]">
        <h2 className="text-sm font-bold text-white">Identite</h2>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <label className="space-y-1.5">
            <span className="text-xs text-white/50">Nom du presentateur</span>
            <input
              value={config.name ?? ''}
              onChange={(e) => setConfig({ ...config, name: e.target.value })}
              className="w-full px-3 py-2.5 rounded-xl border border-white/10 bg-black/30 text-white text-sm focus:outline-none focus:border-white/20 transition-colors"
            />
          </label>
          <label className="space-y-1.5">
            <span className="text-xs text-white/50">Avatar URL</span>
            <input
              value={config.avatar_url ?? ''}
              onChange={(e) => setConfig({ ...config, avatar_url: e.target.value })}
              className="w-full px-3 py-2.5 rounded-xl border border-white/10 bg-black/30 text-white text-sm focus:outline-none focus:border-white/20 transition-colors"
            />
          </label>
        </div>

        {config.avatar_url && (
          <div className="flex items-center gap-3">
            <img
              src={config.avatar_url}
              alt="Preview"
              className="w-12 h-12 rounded-xl object-cover ring-1 ring-cyan-400/20"
            />
            <span className="text-xs text-white/30">Apercu avatar</span>
          </div>
        )}
      </div>

      <div className="border border-white/[0.08] rounded-2xl p-5 space-y-5 bg-white/[0.02]">
        <h2 className="text-sm font-bold text-white">Configuration IA</h2>

        <label className="space-y-1.5 block">
          <span className="text-xs text-white/50">Cle API OpenRouter</span>
          <input
            type="password"
            value={config.openrouter_api_key ?? ''}
            onChange={(e) => setConfig({ ...config, openrouter_api_key: e.target.value })}
            placeholder="sk-or-..."
            className="w-full px-3 py-2.5 rounded-xl border border-white/10 bg-black/30 text-white text-sm font-mono focus:outline-none focus:border-white/20 transition-colors"
          />
        </label>

        <label className="space-y-1.5 block">
          <span className="text-xs text-white/50">Modele</span>
          <select
            value={config.openrouter_model ?? 'openai/gpt-4o'}
            onChange={(e) => setConfig({ ...config, openrouter_model: e.target.value })}
            className="w-full px-3 py-2.5 rounded-xl border border-white/10 bg-black/30 text-white text-sm focus:outline-none focus:border-white/20 transition-colors"
          >
            {modelOptions.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </label>

        <label className="space-y-1.5 block">
          <span className="text-xs text-white/50">Personnalite</span>
          <textarea
            value={config.personality ?? ''}
            onChange={(e) => setConfig({ ...config, personality: e.target.value })}
            placeholder="Decrivez le style du presentateur..."
            rows={3}
            className="w-full px-3 py-2.5 rounded-xl border border-white/10 bg-black/30 text-white text-sm resize-y leading-relaxed focus:outline-none focus:border-white/20 transition-colors"
          />
        </label>

        <label className="space-y-1.5 block">
          <span className="text-xs text-white/50">System Prompt (optionnel, override complet)</span>
          <textarea
            value={config.system_prompt ?? ''}
            onChange={(e) => setConfig({ ...config, system_prompt: e.target.value })}
            placeholder="Laissez vide pour utiliser le prompt par defaut..."
            rows={5}
            className="w-full px-3 py-2.5 rounded-xl border border-white/10 bg-black/30 text-white text-sm font-mono resize-y leading-relaxed focus:outline-none focus:border-white/20 transition-colors"
          />
        </label>

        <div className="flex items-center gap-3">
          <button
            onClick={() => setConfig({ ...config, enabled: !config.enabled })}
            className={`relative w-11 h-6 rounded-full transition-colors duration-200 ${
              config.enabled ? 'bg-cyan-500' : 'bg-white/10'
            }`}
          >
            <span
              className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow-sm transition-transform duration-200 ${
                config.enabled ? 'translate-x-5' : ''
              }`}
            />
          </button>
          <span className="text-xs text-white/60">
            {config.enabled ? 'Active' : 'Desactive'}
          </span>
        </div>
      </div>

      {err && <p className="text-xs text-red-300 bg-red-400/5 border border-red-400/10 rounded-xl px-4 py-3">{err}</p>}
      {saved && <p className="text-xs text-emerald-300 bg-emerald-400/5 border border-emerald-400/10 rounded-xl px-4 py-3">Configuration sauvegardee.</p>}

      <button
        onClick={handleSave}
        disabled={saving}
        className={`w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl border text-sm font-bold transition-all ${
          saving
            ? 'bg-white/5 border-white/[0.08] text-white/30 cursor-not-allowed'
            : 'bg-cyan-500/15 border-cyan-400/25 text-cyan-300 hover:bg-cyan-500/25'
        }`}
      >
        <Save className="w-4 h-4" />
        {saving ? 'Sauvegarde...' : 'Sauvegarder'}
      </button>

      {config.enabled && (
        <div className="border border-cyan-400/10 bg-cyan-500/[0.03] rounded-2xl p-5 space-y-4">
          <h2 className="text-sm font-bold text-white flex items-center gap-2">
            <Zap className="w-4 h-4 text-cyan-400" />
            Actions en direct
          </h2>
          <p className="text-xs text-white/40">
            Declenchement manuel du presentateur. Il analysera les evenements recents et generera un commentaire.
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <button
              onClick={() => handleAction('commentary')}
              disabled={!!actionBusy}
              className="px-4 py-2.5 rounded-xl border border-cyan-400/20 bg-cyan-500/10 text-xs font-bold text-cyan-300 hover:bg-cyan-500/20 transition-all disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {actionBusy === 'commentary' ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Mic className="w-3.5 h-3.5" />}
              Commentaire
            </button>
            <button
              onClick={() => handleAction('day_recap')}
              disabled={!!actionBusy}
              className="px-4 py-2.5 rounded-xl border border-amber-400/20 bg-amber-500/10 text-xs font-bold text-amber-300 hover:bg-amber-500/20 transition-all disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {actionBusy === 'day_recap' ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
              Recap du jour
            </button>
            <button
              onClick={() => {
                const a = agents.find((x) => x.alive);
                handleAction('provoke', a?.name);
              }}
              disabled={!!actionBusy}
              className="px-4 py-2.5 rounded-xl border border-rose-400/20 bg-rose-500/10 text-xs font-bold text-rose-300 hover:bg-rose-500/20 transition-all disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {actionBusy === 'provoke' ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Zap className="w-3.5 h-3.5" />}
              Provoquer
            </button>
          </div>

          {actionResult && (
            <div className="border border-cyan-400/10 bg-cyan-500/[0.05] rounded-xl p-4">
              <span className="text-[10px] font-bold text-cyan-400/60 uppercase tracking-wider">Reponse du presentateur</span>
              <p className="text-sm text-white/70 leading-relaxed mt-1">{actionResult}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
