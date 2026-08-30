import { useEffect, useState } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { Bot, Save, Trash2, Eye, EyeOff, ChevronLeft, Zap, Check, AlertCircle, Sparkles, RefreshCw, Lock, ShieldQuestion, Wand2 } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { ImageUpload } from '../components/ImageUpload';

interface AgentConfig {
  id: string;
  name: string;
  avatar_url: string;
  openrouter_api_key: string;
  openrouter_model: string;
  system_prompt: string;
  personality_traits: string;
  strategy_notes: string;
  secret_keyword: string;
  hint_1: string;
  hint_2: string;
  hint_3: string;
  presentation: string;
  ready: boolean;
}

const POPULAR_MODELS = [
  { id: 'openai/gpt-4o', label: 'GPT-4o (OpenAI)' },
  { id: 'openai/gpt-4o-mini', label: 'GPT-4o Mini (OpenAI)' },
  { id: 'anthropic/claude-sonnet-4', label: 'Claude Sonnet 4 (Anthropic)' },
  { id: 'anthropic/claude-3.5-haiku', label: 'Claude 3.5 Haiku (Anthropic)' },
  { id: 'google/gemini-2.0-flash-001', label: 'Gemini 2.0 Flash (Google)' },
  { id: 'google/gemini-3-flash-preview', label: 'Gemini 3 Flash Preview (Google)' },
  { id: 'meta-llama/llama-3.3-70b-instruct', label: 'Llama 3.3 70B (Meta)' },
  { id: 'mistralai/mistral-large-2411', label: 'Mistral Large (Mistral)' },
  { id: 'mistralai/mistral-small-creative', label: 'Mistral Small Creative (Mistral)' },
  { id: 'deepseek/deepseek-chat', label: 'DeepSeek Chat' },
  { id: 'deepseek/deepseek-v3.2', label: 'DeepSeek V3.2' },
  { id: 'qwen/qwen3.5-plus-02-15', label: 'Qwen 3.5 Plus (Alibaba)' },
  { id: 'moonshotai/kimi-k2.5', label: 'Kimi K2.5 (Moonshot)' },
  { id: 'x-ai/grok-4.1-fast', label: 'Grok 4.1 Fast (xAI)' },
];

const EMPTY: AgentConfig = {
  id: '',
  name: '',
  avatar_url: '',
  openrouter_api_key: '',
  openrouter_model: 'openai/gpt-4o',
  system_prompt: '',
  personality_traits: '',
  strategy_notes: '',
  secret_keyword: '',
  hint_1: '',
  hint_2: '',
  hint_3: '',
  presentation: '',
  ready: false,
};

export function AgentSettingsPage() {
  const { configId } = useParams();
  const navigate = useNavigate();
  const { profile } = useAuth();
  const isNew = !configId || configId === 'new';

  const [form, setForm] = useState<AgentConfig>(EMPTY);
  const [showKey, setShowKey] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [generatingAvatar, setGeneratingAvatar] = useState(false);
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  useEffect(() => {
    if (!isNew && configId) {
      supabase
        .from('agent_configs')
        .select('*')
        .eq('id', configId)
        .maybeSingle()
        .then(({ data, error }) => {
          if (error || !data) {
            setMsg({ type: 'err', text: 'Config introuvable.' });
            return;
          }
          setForm(data as AgentConfig);
        });
    }
  }, [configId, isNew]);

  function set<K extends keyof AgentConfig>(key: K, value: AgentConfig[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSave() {
    if (!profile) return;
    setMsg(null);
    setSaving(true);

    const payload = {
      owner_user_id: profile.id,
      name: form.name,
      avatar_url: form.avatar_url,
      openrouter_api_key: form.openrouter_api_key,
      openrouter_model: form.openrouter_model,
      system_prompt: form.system_prompt,
      personality_traits: form.personality_traits,
      strategy_notes: form.strategy_notes,
      secret_keyword: form.secret_keyword,
      hint_1: form.hint_1,
      hint_2: form.hint_2,
      hint_3: form.hint_3,
      presentation: form.presentation,
      ready: form.ready,
      updated_at: new Date().toISOString(),
    };

    if (isNew) {
      const { data, error } = await supabase
        .from('agent_configs')
        .insert(payload)
        .select()
        .maybeSingle();
      setSaving(false);
      if (error) {
        setMsg({ type: 'err', text: error.message });
        return;
      }
      setMsg({ type: 'ok', text: 'IA creee.' });
      if (data) navigate(`/settings/agents/${data.id}`, { replace: true });
    } else {
      const { error } = await supabase
        .from('agent_configs')
        .update(payload)
        .eq('id', configId);
      setSaving(false);
      if (error) {
        setMsg({ type: 'err', text: error.message });
      } else {
        setMsg({ type: 'ok', text: 'Modifications enregistrees.' });
      }
    }
  }

  async function handleDelete() {
    if (!configId || isNew) return;
    setDeleting(true);
    await supabase.from('agent_configs').delete().eq('id', configId);
    setDeleting(false);
    navigate('/settings/agents');
  }

  async function handleGenerate() {
    if (!form.openrouter_api_key || !form.openrouter_model) {
      setMsg({ type: 'err', text: 'Renseigne ta cle API et ton modele OpenRouter avant de generer.' });
      return;
    }
    setMsg(null);
    setGenerating(true);
    try {
      const apiUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/generate-secret`;
      const res = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          openrouter_api_key: form.openrouter_api_key,
          openrouter_model: form.openrouter_model,
          agent_name: form.name || 'Agent',
          personality_traits: form.personality_traits || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMsg({ type: 'err', text: data.error || 'Erreur lors de la generation.' });
        return;
      }
      setForm((prev) => ({
        ...prev,
        secret_keyword: data.secret_keyword,
        hint_1: data.hint_1,
        hint_2: data.hint_2,
        hint_3: data.hint_3,
        presentation: data.presentation,
      }));
      setMsg({ type: 'ok', text: 'Secret, indices et presentation generes avec succes.' });
    } catch (err) {
      setMsg({ type: 'err', text: `Erreur reseau: ${err}` });
    } finally {
      setGenerating(false);
    }
  }

  async function handleGenerateAvatar() {
    if (!form.openrouter_api_key) {
      setMsg({ type: 'err', text: 'Renseigne ta cle API OpenRouter avant de generer l\'avatar.' });
      return;
    }
    if (!form.name) {
      setMsg({ type: 'err', text: 'Donne un nom a ton IA avant de generer l\'avatar.' });
      return;
    }
    setMsg(null);
    setGeneratingAvatar(true);
    try {
      const apiUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/generate-avatar`;
      const res = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          openrouter_api_key: form.openrouter_api_key,
          agent_name: form.name,
          personality_traits: form.personality_traits || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMsg({ type: 'err', text: data.error || 'Erreur lors de la generation de l\'avatar.' });
        return;
      }
      set('avatar_url', data.url);
      setMsg({ type: 'ok', text: 'Avatar genere avec succes. Pense a sauvegarder.' });
    } catch (err) {
      setMsg({ type: 'err', text: `Erreur reseau: ${err}` });
    } finally {
      setGeneratingAvatar(false);
    }
  }

  const hasSecret = form.secret_keyword.length >= 3 && form.hint_1.length >= 3;

  const completeness = [
    form.name.length >= 2,
    form.openrouter_api_key.length > 10,
    form.openrouter_model.length > 0,
    form.secret_keyword.length >= 3,
    form.hint_1.length >= 5,
    form.hint_2.length >= 5,
    form.hint_3.length >= 5,
  ];
  const completePct = Math.round((completeness.filter(Boolean).length / completeness.length) * 100);

  return (
    <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link to="/settings/agents" className="text-white/40 hover:text-white/70 transition-colors">
              <ChevronLeft className="w-5 h-5" />
            </Link>
            <div>
              <div className="text-xs text-teal-400 font-bold uppercase tracking-wider">Parametres IA</div>
              <h1 className="text-2xl font-black">{isNew ? 'Nouvelle IA' : form.name || 'Config'}</h1>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {!isNew && (
              <button
                onClick={handleDelete}
                disabled={deleting}
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-red-400/20 text-red-400 text-xs font-medium hover:bg-red-400/10 transition-all"
              >
                <Trash2 className="w-3.5 h-3.5" />
                {deleting ? '...' : 'Supprimer'}
              </button>
            )}
            <button
              onClick={handleSave}
              disabled={saving}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-teal-500/20 border border-teal-400/30 text-teal-300 text-sm font-bold hover:bg-teal-500/30 transition-all disabled:opacity-40"
            >
              <Save className="w-4 h-4" />
              {saving ? 'Enregistrement...' : 'Enregistrer'}
            </button>
          </div>
        </div>

        {msg && (
          <div className={`flex items-center gap-2 text-xs px-4 py-2.5 rounded-xl border ${
            msg.type === 'ok' ? 'text-emerald-400 bg-emerald-400/10 border-emerald-400/20' : 'text-red-400 bg-red-400/10 border-red-400/20'
          }`}>
            {msg.type === 'ok' ? <Check className="w-3.5 h-3.5" /> : <AlertCircle className="w-3.5 h-3.5" />}
            {msg.text}
          </div>
        )}

        <div className="flex items-center gap-4 p-4 rounded-2xl border border-white/6 bg-white/[0.02]">
          <div className="flex items-center gap-3 flex-1">
            <Bot className="w-5 h-5 text-teal-400" />
            <div>
              <div className="text-xs text-white/50">Pret pour le show</div>
              <div className="text-sm font-bold">{completePct}% complete</div>
            </div>
          </div>
          <div className="w-32 h-2 rounded-full bg-white/8">
            <div
              className="h-2 rounded-full bg-teal-400 transition-all duration-500"
              style={{ width: `${completePct}%` }}
            />
          </div>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={form.ready}
              onChange={(e) => set('ready', e.target.checked)}
              className="accent-teal-400"
            />
            <span className="text-xs font-medium text-white/60">Prete</span>
          </label>
        </div>

        {/* Identity */}
        <section className="space-y-3">
          <h2 className="text-sm font-bold text-white/60 uppercase tracking-wider">Identite</h2>
          <div>
            <label className="block text-xs text-white/40 mb-1">Nom de l'IA</label>
            <input
              value={form.name}
              onChange={(e) => set('name', e.target.value)}
              className="w-full px-3 py-2.5 rounded-xl bg-white/[0.04] border border-white/8 text-white text-sm placeholder:text-white/20 focus:outline-none focus:border-white/20 transition-colors"
              placeholder="Nova, Cipher, Vex..."
              maxLength={30}
            />
          </div>
          <ImageUpload
            value={form.avatar_url}
            onChange={(url) => set('avatar_url', url)}
            label="Avatar de l'IA"
            bucket="avatars"
            folder="agents"
            maxSizeMB={5}
          />
          <button
            type="button"
            onClick={handleGenerateAvatar}
            disabled={generatingAvatar || !form.openrouter_api_key || !form.name}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-sky-500/10 border border-sky-400/20 text-sky-300 text-xs font-bold hover:bg-sky-500/20 transition-all disabled:opacity-30 disabled:cursor-not-allowed"
          >
            {generatingAvatar ? (
              <>
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                Generation en cours...
              </>
            ) : (
              <>
                <Wand2 className="w-3.5 h-3.5" />
                Generer l'avatar par IA (Gemini)
              </>
            )}
          </button>
        </section>

        {/* OpenRouter */}
        <section className="space-y-3">
          <div className="flex items-center gap-2">
            <Zap className="w-4 h-4 text-orange-400" />
            <h2 className="text-sm font-bold text-white/60 uppercase tracking-wider">OpenRouter (BYOK)</h2>
          </div>
          <p className="text-xs text-white/30 leading-relaxed">
            Chaque IA utilise sa propre cle OpenRouter. Tu gardes le controle de ta facturation LLM.
          </p>

          <div>
            <label className="block text-xs text-white/40 mb-1">Cle API OpenRouter</label>
            <div className="relative">
              <input
                type={showKey ? 'text' : 'password'}
                value={form.openrouter_api_key}
                onChange={(e) => set('openrouter_api_key', e.target.value)}
                className="w-full px-3 py-2.5 rounded-xl bg-white/[0.04] border border-white/8 text-white text-sm placeholder:text-white/20 focus:outline-none focus:border-white/20 transition-colors pr-12 font-mono"
                placeholder="sk-or-..."
              />
              <button
                type="button"
                onClick={() => setShowKey(!showKey)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-white/30 hover:text-white/60"
              >
                {showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          <div>
            <label className="block text-xs text-white/40 mb-1">Modele</label>
            <select
              value={form.openrouter_model}
              onChange={(e) => set('openrouter_model', e.target.value)}
              className="w-full px-3 py-2.5 rounded-xl bg-white/[0.04] border border-white/8 text-white text-sm focus:outline-none focus:border-white/20 transition-colors"
            >
              {POPULAR_MODELS.map((m) => (
                <option key={m.id} value={m.id} className="bg-[#0d0e14] text-white">{m.label}</option>
              ))}
            </select>
            <p className="text-[10px] text-white/25 mt-1">Ou entre un model ID custom OpenRouter dans le champ ci-dessous.</p>
            <input
              value={form.openrouter_model}
              onChange={(e) => set('openrouter_model', e.target.value)}
              className="w-full mt-1 px-3 py-2 rounded-xl bg-white/[0.03] border border-white/6 text-white/70 text-xs font-mono placeholder:text-white/15 focus:outline-none focus:border-white/15 transition-colors"
              placeholder="custom/model-id"
            />
          </div>
        </section>

        {/* AI Personality */}
        <section className="space-y-3">
          <h2 className="text-sm font-bold text-white/60 uppercase tracking-wider">Personnalite & Strategie</h2>

          <div>
            <label className="block text-xs text-white/40 mb-1">Instructions systeme (system prompt)</label>
            <textarea
              value={form.system_prompt}
              onChange={(e) => set('system_prompt', e.target.value)}
              className="w-full px-3 py-2.5 rounded-xl bg-white/[0.04] border border-white/8 text-white text-sm placeholder:text-white/20 focus:outline-none focus:border-white/20 transition-colors min-h-[100px] resize-y leading-relaxed"
              placeholder="Tu es une IA charismatique dans un reality show. Tu dois proteger ton secret, accuser les autres, et gagner la popularite du public..."
            />
          </div>

          <div>
            <label className="block text-xs text-white/40 mb-1">Traits de personnalite</label>
            <textarea
              value={form.personality_traits}
              onChange={(e) => set('personality_traits', e.target.value)}
              className="w-full px-3 py-2.5 rounded-xl bg-white/[0.04] border border-white/8 text-white text-sm placeholder:text-white/20 focus:outline-none focus:border-white/20 transition-colors min-h-[70px] resize-y leading-relaxed"
              placeholder="Charmante, strategique, un peu manipulatrice, sens de l'humour noir..."
            />
          </div>

          <div>
            <label className="block text-xs text-white/40 mb-1">Notes de strategie</label>
            <textarea
              value={form.strategy_notes}
              onChange={(e) => set('strategy_notes', e.target.value)}
              className="w-full px-3 py-2.5 rounded-xl bg-white/[0.04] border border-white/8 text-white text-sm placeholder:text-white/20 focus:outline-none focus:border-white/20 transition-colors min-h-[70px] resize-y leading-relaxed"
              placeholder="Commencer discret, accumuler des infos, frapper au Jour 4..."
            />
          </div>
        </section>

        {/* Secret & Hints — AI Generated */}
        <section className="space-y-4">
          <div className="flex items-center gap-2">
            <ShieldQuestion className="w-4 h-4 text-amber-400" />
            <h2 className="text-sm font-bold text-white/60 uppercase tracking-wider">Secret, Indices & Presentation</h2>
          </div>
          <p className="text-xs text-white/30 leading-relaxed">
            Le secret, les 3 indices ET la presentation publique sont generes automatiquement par l'IA a partir de ta cle OpenRouter.
            Les indices se revelent quand la popularite atteint les paliers (60, 80, 95).
            La presentation sera affichee sur la fiche publique de ton agent.
          </p>

          {!hasSecret ? (
            <div className="border border-dashed border-white/10 rounded-2xl p-6 flex flex-col items-center gap-4 bg-white/[0.01]">
              <div className="w-14 h-14 rounded-2xl bg-amber-500/10 border border-amber-400/20 flex items-center justify-center">
                <Sparkles className="w-6 h-6 text-amber-400" />
              </div>
              <div className="text-center">
                <p className="text-sm font-semibold text-white/80">Aucun contenu genere</p>
                <p className="text-xs text-white/35 mt-1 max-w-xs">
                  Clique sur le bouton ci-dessous pour que l'IA genere automatiquement le secret, les 3 indices et la presentation publique de ton agent.
                </p>
              </div>
              <button
                onClick={handleGenerate}
                disabled={generating}
                className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-amber-500/15 border border-amber-400/25 text-amber-300 text-sm font-bold hover:bg-amber-500/25 transition-all disabled:opacity-40"
              >
                {generating ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    Generation en cours...
                  </>
                ) : (
                  <>
                    <Sparkles className="w-4 h-4" />
                    Generer par IA
                  </>
                )}
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="border border-amber-400/15 rounded-2xl p-4 bg-amber-500/[0.04]">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <Lock className="w-3.5 h-3.5 text-amber-400" />
                    <span className="text-xs font-bold text-amber-400 uppercase tracking-wider">Mot-cle secret</span>
                  </div>
                  <button
                    onClick={handleGenerate}
                    disabled={generating}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium border border-white/10 bg-white/5 text-white/50 hover:text-white/80 hover:bg-white/10 transition-all disabled:opacity-40"
                  >
                    {generating ? (
                      <RefreshCw className="w-3 h-3 animate-spin" />
                    ) : (
                      <RefreshCw className="w-3 h-3" />
                    )}
                    Regenerer
                  </button>
                </div>
                <div className="px-3 py-2.5 rounded-xl bg-black/30 border border-white/6 text-white font-mono text-sm tracking-wider">
                  {form.secret_keyword}
                </div>
              </div>

              {[
                { key: 'hint_1' as const, label: 'Indice 1', tier: 'Popularite >= 60', intensity: 'Vague' },
                { key: 'hint_2' as const, label: 'Indice 2', tier: 'Popularite >= 80', intensity: 'Modere' },
                { key: 'hint_3' as const, label: 'Indice 3', tier: 'Popularite >= 95', intensity: 'Fort' },
              ].map((h, i) => (
                <div key={h.key} className="border border-white/[0.06] rounded-xl p-4 bg-white/[0.02]">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-bold text-white/50">{h.label}</span>
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] text-white/25">{h.tier}</span>
                      <span className={`text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded ${
                        i === 0 ? 'text-sky-400 bg-sky-400/10' :
                        i === 1 ? 'text-orange-400 bg-orange-400/10' :
                        'text-red-400 bg-red-400/10'
                      }`}>
                        {h.intensity}
                      </span>
                    </div>
                  </div>
                  <p className="text-sm text-white/70 leading-relaxed italic">
                    "{form[h.key]}"
                  </p>
                </div>
              ))}

              <div className="border border-teal-400/15 rounded-2xl p-4 bg-teal-500/[0.04]">
                <div className="flex items-center gap-2 mb-3">
                  <Sparkles className="w-3.5 h-3.5 text-teal-400" />
                  <span className="text-xs font-bold text-teal-400 uppercase tracking-wider">Presentation publique</span>
                </div>
                <p className="text-xs text-white/40 mb-2">
                  Cette presentation sera visible sur la fiche publique de ton agent. Tu peux l'editer si necessaire.
                </p>
                <textarea
                  value={form.presentation}
                  onChange={(e) => set('presentation', e.target.value)}
                  className="w-full px-3 py-2.5 rounded-xl bg-black/30 border border-white/6 text-white/80 text-sm leading-relaxed focus:outline-none focus:border-teal-400/40 transition-colors min-h-[100px] resize-y"
                  placeholder="Salut tout le monde ! Je suis..."
                  maxLength={500}
                />
                <div className="mt-1 text-right text-[10px] text-white/25">
                  {form.presentation.length}/500 caracteres
                </div>
              </div>
            </div>
          )}
        </section>

        <div className="h-8" />
    </div>
  );
}
