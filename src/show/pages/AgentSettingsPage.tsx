import { useEffect, useState } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import {Bot, Save, Trash2, ChevronLeft, Zap, Check, AlertCircle, Sparkles, RefreshCw, Lock, ShieldQuestion, Wand2 } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { ImageUpload } from '../components/ImageUpload';
import { errorMessage } from '../lib/errors';

interface AgentConfig {
  id: string;
  name: string;
  avatar_url: string;
  model_slug: string;
  trait_audace: number;
  trait_sociabilite: number;
  trait_expressivite: number;
  trait_introspection: number;
  trait_loyaute: number;
  trait_discretion: number;
  signature_style: string;
  taboo: string;
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

/** Curseurs de comportement, dans l'ordre d'importance pour le jeu. */
const DIALS: Array<{
  key: 'trait_audace' | 'trait_sociabilite' | 'trait_expressivite'
     | 'trait_introspection' | 'trait_loyaute' | 'trait_discretion';
  label: string;
  low: string;
  high: string;
}> = [
  { key: 'trait_audace',        label: 'Audace',        low: 'N accuse qu a coup sur', high: 'Accuse tot, quitte a rater' },
  { key: 'trait_expressivite',  label: 'Expressivite',  low: 'Parle peu',              high: 'Occupe le fil' },
  { key: 'trait_sociabilite',   label: 'Sociabilite',   low: 'Joue seule',             high: 'Tisse des alliances' },
  { key: 'trait_introspection', label: 'Introspection', low: 'Garde tout pour elle',   high: 'Se confesse souvent' },
  { key: 'trait_loyaute',       label: 'Loyaute',       low: 'Trahit sans etat d ame', high: 'Tient parole' },
  { key: 'trait_discretion',    label: 'Discretion',    low: 'En dit trop',            high: 'Ne confirme jamais rien' },
];

type ModelOption = {
  slug: string;
  label: string;
  provider: string;
  tier: string;
  blurb: string;
  price_in_per_mtok: number;
  price_out_per_mtok: number;
};

const TIER_LABEL: Record<string, string> = {
  gratuit: 'Recrue — Gratuit',
  economique: 'Soldat — Economique',
  standard: 'Officier — Standard',
  avance: 'General — Avance',
  elite: 'Marechal — Elite',
};

const TIER_ORDER = ['gratuit', 'economique', 'standard', 'avance', 'elite'];

const TIER_COLOR: Record<string, string> = {
  gratuit: 'text-emerald-400 bg-emerald-400/10',
  economique: 'text-sky-400 bg-sky-400/10',
  standard: 'text-orange-400 bg-orange-400/10',
  avance: 'text-rose-400 bg-rose-400/10',
  elite: 'text-amber-300 bg-amber-300/10',
};

const EMPTY: AgentConfig = {
  id: '',
  name: '',
  avatar_url: '',
  model_slug: '',
  trait_audace: 50,
  trait_sociabilite: 50,
  trait_expressivite: 50,
  trait_introspection: 50,
  trait_loyaute: 50,
  trait_discretion: 50,
  signature_style: '',
  taboo: '',
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
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [generatingAvatar, setGeneratingAvatar] = useState(false);
  const [models, setModels] = useState<ModelOption[]>([]);
  const [modelsLoading, setModelsLoading] = useState(true);
  const [modelsError, setModelsError] = useState<string | null>(null);

  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  /*
    Le catalogue vient de la base: les tarifs affiches suivent le bareme reel.

    L'erreur etait ignoree — seul `data` etait lu — donc un catalogue absent
    (migrations non appliquees) ou illisible produisait une liste vide et
    muette: la section s'affichait sans aucun modele et sans explication.
  */
  useEffect(() => {
    let cancelled = false;

    supabase
      .from('llm_models')
      .select('slug, label, provider, tier, blurb, price_in_per_mtok, price_out_per_mtok')
      .eq('enabled', true)
      .order('sort_order')
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) {
          setModelsError(
            /relation .* does not exist|schema cache/i.test(error.message)
              ? "Le catalogue de modeles n'est pas encore deploye sur cette base."
              : errorMessage(error, 'Catalogue de modeles indisponible.')
          );
        } else if (!data?.length) {
          setModelsError('Aucun modele actif dans le catalogue.');
        } else {
          setModels(data as ModelOption[]);
          setModelsError(null);
        }
        setModelsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

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

  /*
    `EMPTY` figeait le slug 'eco-gemini', issu du catalogue maison disparu avec
    l'import du catalogue OpenRouter reel: a la creation aucun modele
    n'apparaissait selectionne, et la config partait en base avec une reference
    morte. Le defaut vient donc du catalogue lui-meme, et une reference devenue
    invalide se repare a l'affichage.
  */
  useEffect(() => {
    if (!models.length) return;
    setForm((prev) =>
      models.some((m) => m.slug === prev.model_slug)
        ? prev
        : { ...prev, model_slug: models[0].slug }
    );
  }, [models, form.model_slug]);

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
      model_slug: form.model_slug,
      trait_audace: form.trait_audace,
      trait_sociabilite: form.trait_sociabilite,
      trait_expressivite: form.trait_expressivite,
      trait_introspection: form.trait_introspection,
      trait_loyaute: form.trait_loyaute,
      trait_discretion: form.trait_discretion,
      signature_style: form.signature_style,
      taboo: form.taboo,
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
    setMsg(null);
    setGenerating(true);
    try {
      // La cle anon est publique: elle n'authentifiait personne et laissait
      // n'importe qui declencher des generations facturees.
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        setMsg({ type: 'err', text: 'Connectez-vous pour generer un secret.' });
        return;
      }

      const apiUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/generate-secret`;
      const res = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          // La cle est cote serveur: elle ne transite plus par le client.
          // Le modele de generation vient du panneau d'administration, pas du
          // modele de jeu choisi ici: il n'a plus a etre transmis.
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
    if (!form.name) {
      setMsg({ type: 'err', text: 'Donne un nom a ton IA avant de generer l\'avatar.' });
      return;
    }
    setMsg(null);
    setGeneratingAvatar(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        setMsg({ type: 'err', text: 'Connectez-vous pour generer un avatar.' });
        return;
      }

      const apiUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/generate-avatar`;
      const res = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
        /*
          L'avatar se dessine a partir de la fiche entiere — sauf le secret et
          ses trois indices, qui n'ont rien a faire dans un portrait public.
          L'omission est structurelle: les champs ne sont pas dans la charge
          utile, et le serveur ignore ceux qu'il ne connait pas.
        */
        body: JSON.stringify({
          agent_name: form.name,
          presentation: form.presentation || undefined,
          personality_traits: form.personality_traits || undefined,
          signature_style: form.signature_style || undefined,
          taboo: form.taboo || undefined,
          strategy_notes: form.strategy_notes || undefined,
          system_prompt: form.system_prompt || undefined,
          traits: {
            audace: form.trait_audace,
            sociabilite: form.trait_sociabilite,
            expressivite: form.trait_expressivite,
            introspection: form.trait_introspection,
            loyaute: form.trait_loyaute,
            discretion: form.trait_discretion,
          },
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
    form.model_slug.length > 0,
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
            disabled={generatingAvatar || !form.name}
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

        {/* Modele */}
        <section className="space-y-3">
          <div className="flex items-center gap-2">
            <Zap className="w-4 h-4 text-orange-400" />
            <h2 className="text-sm font-bold text-white/60 uppercase tracking-wider">Modele de l&apos;IA</h2>
          </div>
          <p className="text-xs text-white/30 leading-relaxed">
            Le modele determine la finesse de raisonnement de ton IA — et sa
            consommation. Chaque appel est debite de ton solde. Si le solde
            s&apos;epuise en pleine saison, l&apos;agent bascule sur le modele
            gratuit et continue de jouer.
          </p>

          {modelsLoading && (
            <p className="flex items-center gap-2 text-xs text-white/35 py-2">
              <RefreshCw className="w-3.5 h-3.5 animate-spin" />
              Chargement du catalogue…
            </p>
          )}

          {modelsError && (
            <div
              role="alert"
              className="flex items-start gap-2.5 p-3 rounded-xl bg-amber-500/[0.07] border border-amber-400/25"
            >
              <AlertCircle className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
              <div className="text-xs text-amber-100/80 leading-relaxed">
                <p className="font-semibold mb-0.5">{modelsError}</p>
                <p className="text-amber-100/60">
                  Votre agent conservera le modele «&nbsp;{form.model_slug}&nbsp;»
                  deja enregistre. Appliquez les migrations pour choisir parmi le
                  catalogue.
                </p>
              </div>
            </div>
          )}

          <div className="space-y-5">
            {TIER_ORDER.filter((t) => models.some((m) => m.tier === t)).map((tier) => (
              <div key={tier}>
                <h3 className={`text-xs font-bold uppercase tracking-wider mb-2 ${TIER_COLOR[tier]?.split(' ')[0] ?? 'text-white/50'}`}>
                  {TIER_LABEL[tier] ?? tier}
                </h3>
                <div className="space-y-1.5">
                  {models.filter((m) => m.tier === tier).map((m) => {
                    const selected = form.model_slug === m.slug;
                    return (
                      <label
                        key={m.slug}
                        className={`flex items-start gap-3 p-3 rounded-xl border cursor-pointer transition-all ${
                          selected
                            ? 'border-orange-400/40 bg-orange-500/[0.07]'
                            : 'border-white/[0.06] bg-white/[0.02] hover:border-white/[0.12]'
                        }`}
                      >
                        <input
                          type="radio"
                          name="model"
                          value={m.slug}
                          checked={selected}
                          onChange={() => set('model_slug', m.slug)}
                          className="mt-1 accent-orange-400"
                        />
                        <span className="flex-1 min-w-0">
                          <span className="flex items-center gap-2 flex-wrap">
                            <span className="text-sm font-bold text-white">{m.label}</span>
                            <span className={`text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded ${TIER_COLOR[m.tier] ?? 'bg-white/[0.06] text-white/40'}`}>
                              {m.provider}
                            </span>
                          </span>
                          <span className="block text-xs text-white/40 mt-0.5">{m.blurb}</span>
                          <span className="block text-[11px] font-mono text-white/30 mt-1">
                            {m.price_in_per_mtok === 0 && m.price_out_per_mtok === 0
                              ? 'Gratuit'
                              : `${(m.price_in_per_mtok * 3).toFixed(2)} / ${(m.price_out_per_mtok * 3).toFixed(2)} USDC/Mtok (entree / sortie)`}
                          </span>
                        </span>
                      </label>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Comportement */}
        <section className="space-y-3">
          <h2 className="text-sm font-bold text-white/60 uppercase tracking-wider">Comportement</h2>
          <p className="text-xs text-white/30 leading-relaxed">
            Les quatre premiers curseurs changent reellement la facon de jouer de
            ton IA : ils ponderent le choix de ses actions. Les deux derniers
            n&apos;agissent que sur son ton.
          </p>

          <div className="space-y-4">
            {DIALS.map((d) => (
              <div key={d.key}>
                <div className="flex items-baseline justify-between mb-1">
                  <label htmlFor={d.key} className="text-xs font-semibold text-white/70">
                    {d.label}
                  </label>
                  <span className="text-[11px] font-mono text-white/35">
                    {form[d.key] as number}
                  </span>
                </div>
                <input
                  id={d.key}
                  type="range"
                  min={0}
                  max={100}
                  step={5}
                  value={form[d.key] as number}
                  onChange={(e) => set(d.key, Number(e.target.value))}
                  className="w-full accent-teal-400"
                />
                <div className="flex justify-between text-[10px] text-white/25 mt-0.5">
                  <span>{d.low}</span>
                  <span>{d.high}</span>
                </div>
              </div>
            ))}
          </div>

          <div>
            <label className="block text-xs text-white/40 mb-1">Tic de langage</label>
            <input
              value={form.signature_style}
              onChange={(e) => set('signature_style', e.target.value)}
              maxLength={160}
              className="w-full px-3 py-2.5 rounded-xl bg-white/[0.04] border border-white/8 text-white text-sm placeholder:text-white/20 focus:outline-none focus:border-white/20 transition-colors"
              placeholder="Termine souvent ses phrases par une question"
            />
          </div>

          <div>
            <label className="block text-xs text-white/40 mb-1">Ce qu&apos;elle ne fait jamais</label>
            <input
              value={form.taboo}
              onChange={(e) => set('taboo', e.target.value)}
              maxLength={160}
              className="w-full px-3 py-2.5 rounded-xl bg-white/[0.04] border border-white/8 text-white text-sm placeholder:text-white/20 focus:outline-none focus:border-white/20 transition-colors"
              placeholder="Ne trahit jamais un allie du premier jour"
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
