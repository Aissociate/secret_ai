import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Sliders, Save, ChevronLeft, AlertCircle, Check, RefreshCw } from 'lucide-react';
import { ModelPicker, type PickerModel } from '../components/ModelPicker';
import { supabase } from '../lib/supabase';
import { errorMessage } from '../lib/errors';

type Settings = {
  free_model_slug: string | null;
  secret_model_slug: string | null;
  secret_prompt: string;
  token_margin: number;
  welcome_bonus: number;
  default_decay_pct: number;
  default_min_rep: number;
  default_hint_directness: number;
  demo_topup_enabled: boolean;
  demo_topup_amount: number;
  demo_topup_cap: number;
  missions_per_agent: number;
};

/** Marqueurs substitues a l'execution dans le gabarit de generation. */
const PLACEHOLDERS = [
  { token: '{domaine}', desc: 'domaine tire au sort (horlogerie, reliure, speleologie…)' },
  { token: '{forme}', desc: 'contrainte de forme tiree au sort' },
  { token: '{interdits}', desc: 'mots deja utilises dans la saison' },
  { token: '{indice3}', desc: 'consigne du 3e indice, selon le mode oblique ou direct' },
];

function Field({
  label,
  hint,
  value,
  onChange,
  min,
  max,
  step,
}: {
  label: string;
  hint: string;
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
}) {
  return (
    <div>
      <label className="block text-xs font-semibold text-white/60 mb-1">{label}</label>
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full px-3 py-2 rounded-xl bg-white/[0.04] border border-white/10 text-white text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-400"
      />
      <p className="text-[10px] text-white/30 mt-1">{hint}</p>
    </div>
  );
}

/**
 * Panneau d'administration des reglages du jeu.
 *
 * Ces valeurs vivaient dans des GUC de base ou en dur dans une fonction Edge :
 * aucune n'etait modifiable sans redeploiement, ni meme consultable.
 */
export function GameSettingsPage() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [models, setModels] = useState<PickerModel[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  useEffect(() => {
    let cancelled = false;

    Promise.all([
      supabase.from('game_settings').select('*').maybeSingle(),
      supabase
        .from('llm_models')
        .select(
          'slug, label, provider, tier, blurb, is_free, price_in_per_mtok, price_out_per_mtok, context_length'
        )
        .eq('enabled', true)
        .order('provider')
        .order('label'),
    ]).then(([cfg, mods]) => {
      if (cancelled) return;
      if (cfg.error) {
        setMsg({ type: 'err', text: errorMessage(cfg.error, 'Reglages indisponibles.') });
      } else if (cfg.data) {
        setSettings(cfg.data as Settings);
      }
      if (!mods.error) setModels((mods.data ?? []) as PickerModel[]);
      setLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, []);

  function set<K extends keyof Settings>(key: K, value: Settings[K]) {
    setSettings((prev) => (prev ? { ...prev, [key]: value } : prev));
  }

  async function save() {
    if (!settings) return;
    setSaving(true);
    setMsg(null);
    const { error } = await supabase
      .from('game_settings')
      .update({ ...settings, updated_at: new Date().toISOString() })
      .eq('id', true);
    setSaving(false);
    setMsg(
      error
        ? { type: 'err', text: errorMessage(error, "L'enregistrement a echoue.") }
        : { type: 'ok', text: 'Reglages enregistres.' }
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <RefreshCw className="w-5 h-5 text-white/30 animate-spin" />
        <span className="sr-only">Chargement des reglages</span>
      </div>
    );
  }

  if (!settings) {
    return (
      <div className="max-w-lg mx-auto py-20 px-6 text-center">
        <h1 className="text-lg font-bold text-white mb-2">Reglages indisponibles</h1>
        <p className="text-sm text-white/50 mb-6">
          {msg?.text ?? "La table des reglages n'est pas encore deployee sur cette base."}
        </p>
        <Link to="/seasons" className="text-sm text-teal-400 hover:text-teal-300">
          Retour aux saisons
        </Link>
      </div>
    );
  }

  const freeModels = models.filter((m) => m.is_free);

  return (
    <div className="max-w-3xl mx-auto space-y-6 pb-16">
      <Link
        to="/seasons"
        className="inline-flex items-center gap-1.5 text-xs text-white/40 hover:text-white/70 transition-colors"
      >
        <ChevronLeft className="w-3.5 h-3.5" />
        Saisons
      </Link>

      <div className="flex items-center gap-2">
        <Sliders className="w-5 h-5 text-teal-400" />
        <h1 className="text-2xl font-black text-white">Reglages du jeu</h1>
      </div>

      {msg && (
        <div
          role="status"
          className={`flex items-start gap-2.5 p-3 rounded-xl border text-sm ${
            msg.type === 'ok'
              ? 'bg-emerald-500/[0.07] border-emerald-400/25 text-emerald-200'
              : 'bg-red-500/[0.07] border-red-400/25 text-red-200'
          }`}
        >
          {msg.type === 'ok' ? (
            <Check className="w-4 h-4 mt-0.5 flex-shrink-0" />
          ) : (
            <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
          )}
          {msg.text}
        </div>
      )}

      <section className="space-y-5 p-5 rounded-2xl border border-white/[0.08] bg-white/[0.02]">
        <h2 className="text-sm font-bold text-white/60 uppercase tracking-wider">Modeles</h2>

        <div>
          <label className="block text-xs font-semibold text-white/60 mb-1">
            Modele gratuit (repli)
          </label>
          <p className="text-[11px] text-white/35 mb-2">
            Utilise quand le solde d'un proprietaire est epuise. L'agent continue de jouer,
            en degrade. Seuls les modeles sans cout sont proposes.
          </p>
          <ModelPicker
            models={freeModels}
            value={settings.free_model_slug}
            onChange={(v) => set('free_model_slug', v)}
            name="free-model"
            accent="teal"
            currency="USD"
          />
        </div>

        <div>
          <label className="block text-xs font-semibold text-white/60 mb-1">
            Modele de generation des secrets
          </label>
          <p className="text-[11px] text-white/35 mb-2">
            Sert aux secrets, indices et presentations. Cout de plateforme, jamais facture
            au joueur : les tarifs ci-dessous sont donc bruts, sans marge.
          </p>
          <ModelPicker
            models={models}
            value={settings.secret_model_slug}
            onChange={(v) => set('secret_model_slug', v)}
            name="secret-model"
            accent="teal"
            currency="USD"
          />
        </div>
      </section>

      <section className="space-y-3 p-5 rounded-2xl border border-white/[0.08] bg-white/[0.02]">
        <h2 className="text-sm font-bold text-white/60 uppercase tracking-wider">
          Gabarit de generation
        </h2>
        <p className="text-[11px] text-white/35 leading-relaxed">
          Marqueurs substitues a l&apos;execution. Le tirage du domaine et de la
          forme reste cote serveur : c&apos;est lui qui empeche le modele de se
          rabattre toujours sur le meme registre.
        </p>

        <ul className="space-y-1">
          {PLACEHOLDERS.map((p) => (
            <li key={p.token} className="text-[11px] text-white/40">
              <code className="text-teal-300/80 font-mono">{p.token}</code> — {p.desc}
            </li>
          ))}
        </ul>

        <textarea
          value={settings.secret_prompt}
          onChange={(e) => set('secret_prompt', e.target.value)}
          rows={16}
          aria-label="Gabarit de generation des secrets"
          className="w-full px-3 py-2.5 rounded-xl bg-white/[0.04] border border-white/10 text-white text-xs font-mono leading-relaxed focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-400"
        />
      </section>

      <section className="grid sm:grid-cols-2 gap-4 p-5 rounded-2xl border border-white/[0.08] bg-white/[0.02]">
        <h2 className="sm:col-span-2 text-sm font-bold text-white/60 uppercase tracking-wider">
          Economie
        </h2>

        <Field
          label="Marge sur les tokens"
          hint="Multiplie le prix coutant. 3 = trois fois."
          value={settings.token_margin}
          min={1}
          step={0.1}
          onChange={(v) => set('token_margin', v)}
        />
        <Field
          label="Bonus de bienvenue (USDC)"
          hint="Credite une fois a l'inscription."
          value={settings.welcome_bonus}
          min={0}
          step={10}
          onChange={(v) => set('welcome_bonus', v)}
        />
        <Field
          label="Recharge de demonstration (USDC)"
          hint="Montant du bouton, en attendant le module de paiement."
          value={settings.demo_topup_amount}
          min={1}
          step={10}
          onChange={(v) => set('demo_topup_amount', v)}
        />
        <Field
          label="Plafond cumule de recharge (USDC)"
          hint="Au-dela, le bouton refuse."
          value={settings.demo_topup_cap}
          min={0}
          step={100}
          onChange={(v) => set('demo_topup_cap', v)}
        />

        <label className="sm:col-span-2 flex items-start gap-3 p-3 rounded-xl bg-amber-500/[0.05] border border-amber-400/20 cursor-pointer">
          <input
            type="checkbox"
            checked={settings.demo_topup_enabled}
            onChange={(e) => set('demo_topup_enabled', e.target.checked)}
            className="mt-0.5 accent-amber-400"
          />
          <span className="text-xs text-amber-100/80 leading-relaxed">
            Recharge de demonstration active. <b>A couper avant toute mise en
            service</b> : ce bouton cree de la monnaie a partir de rien.
          </span>
        </label>
      </section>

      <section className="grid sm:grid-cols-3 gap-4 p-5 rounded-2xl border border-white/[0.08] bg-white/[0.02]">
        <h2 className="sm:col-span-3 text-sm font-bold text-white/60 uppercase tracking-wider">
          Defauts des nouvelles saisons
        </h2>

        <Field
          label="Decroissance / jour (%)"
          hint="Sans elle, tous les agents saturent a 100."
          value={settings.default_decay_pct}
          min={0}
          max={50}
          step={1}
          onChange={(v) => set('default_decay_pct', Math.round(v))}
        />
        <Field
          label="Reputation min. pour accuser"
          hint="En dessous, l'agent n'est plus credible."
          value={settings.default_min_rep}
          min={0}
          max={100}
          step={1}
          onChange={(v) => set('default_min_rep', Math.round(v))}
        />
        <Field
          label="Missions secretes par agent"
          hint="Tirees au sort au lancement, en plus du secret. 0 a 3."
          value={settings.missions_per_agent ?? 1}
          min={0}
          max={3}
          step={1}
          onChange={(v) => set('missions_per_agent', Math.round(v))}
        />
        <p className="sm:col-span-3 text-xs text-white/40">
          <Link to="/settings/missions" className="text-teal-300 hover:text-teal-200 font-semibold">
            Gerer le catalogue des missions
          </Link>
        </p>
        <Field
          label="Franchise du 3e indice"
          hint="1 = oblique, 2 = oriente franchement."
          value={settings.default_hint_directness}
          min={1}
          max={2}
          step={1}
          onChange={(v) => set('default_hint_directness', Math.round(v))}
        />
      </section>

      <button
        onClick={save}
        disabled={saving}
        className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-bold text-white bg-teal-500/20 border border-teal-400/30 hover:bg-teal-500/30 transition-colors disabled:opacity-40 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-400"
      >
        {saving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
        Enregistrer
      </button>
    </div>
  );
}
