import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Target, Plus, Save, Trash2, ChevronLeft, RefreshCw } from 'lucide-react';
import { fetchMissions, upsertMission, deleteMission } from '../api/client';
import type { Mission, MissionKind } from '../api/types';
import { errorMessage } from '../lib/errors';

const KIND_LABEL: Record<MissionKind, string> = {
  social: 'Social',
  deception: 'Manipulation',
  survival: 'Survie',
  intel: 'Renseignement',
  chaos: 'Chaos',
};

const EMPTY: Partial<Mission> = {
  title: '',
  brief: '',
  kind: 'social',
  difficulty: 1,
  reward_popularity: 5,
  reward_reputation: 5,
  penalty_reputation: 3,
  duration_days: 3,
  active: true,
};

const inputCls =
  'w-full px-3 py-2 rounded-xl bg-white/[0.04] border border-white/10 text-white text-sm focus:outline-none focus:border-teal-400/40';

function MissionForm({
  value,
  onChange,
}: {
  value: Partial<Mission>;
  onChange: (v: Partial<Mission>) => void;
}) {
  const set = <K extends keyof Mission>(k: K, v: Mission[K]) => onChange({ ...value, [k]: v });
  return (
    <div className="space-y-2">
      <input
        className={inputCls}
        placeholder="Titre court"
        value={value.title ?? ''}
        onChange={(e) => set('title', e.target.value)}
      />
      <textarea
        className={`${inputCls} min-h-[64px]`}
        placeholder="Consigne donnee a l'agent, a la deuxieme personne"
        value={value.brief ?? ''}
        onChange={(e) => set('brief', e.target.value)}
      />
      <div className="grid grid-cols-2 sm:grid-cols-7 gap-2">
        <select className={inputCls} value={value.kind ?? 'social'} onChange={(e) => set('kind', e.target.value as MissionKind)}>
          {(Object.keys(KIND_LABEL) as MissionKind[]).map((k) => (
            <option key={k} value={k}>{KIND_LABEL[k]}</option>
          ))}
        </select>
        <label className="text-[10px] text-white/40">
          Difficulte
          <input type="number" min={1} max={3} className={inputCls} value={value.difficulty ?? 1} onChange={(e) => set('difficulty', Number(e.target.value))} />
        </label>
        <label className="text-[10px] text-white/40">
          +Pop
          <input type="number" min={0} max={50} className={inputCls} value={value.reward_popularity ?? 0} onChange={(e) => set('reward_popularity', Number(e.target.value))} />
        </label>
        <label className="text-[10px] text-white/40">
          +Rep
          <input type="number" min={0} max={50} className={inputCls} value={value.reward_reputation ?? 0} onChange={(e) => set('reward_reputation', Number(e.target.value))} />
        </label>
        <label className="text-[10px] text-white/40">
          -Rep si echec
          <input type="number" min={0} max={50} className={inputCls} value={value.penalty_reputation ?? 0} onChange={(e) => set('penalty_reputation', Number(e.target.value))} />
        </label>
        <label className="text-[10px] text-white/40">
          Delai (jours)
          <input type="number" min={1} max={14} className={inputCls} value={value.duration_days ?? 3} onChange={(e) => set('duration_days', Number(e.target.value))} />
        </label>
        <label className="flex items-center gap-2 text-xs text-white/60 mt-4">
          <input type="checkbox" checked={value.active ?? true} onChange={(e) => set('active', e.target.checked)} />
          Active
        </label>
      </div>
    </div>
  );
}

/*
  Catalogue des missions secretes. L'admin le fait vivre; le tirage au sort
  se sert dans les missions actives a chaque distribution.
*/
export function MissionsSettingsPage() {
  const [missions, setMissions] = useState<Mission[]>([]);
  const [drafts, setDrafts] = useState<Record<string, Partial<Mission>>>({});
  const [draftNew, setDraftNew] = useState<Partial<Mission>>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  async function load() {
    setMissions(await fetchMissions());
  }

  useEffect(() => {
    let cancelled = false;
    load()
      .catch((e) => !cancelled && setMsg({ type: 'err', text: errorMessage(e, 'Chargement impossible') }))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, []);

  async function save(id: string | null, value: Partial<Mission>) {
    if (!value.title?.trim() || !value.brief?.trim()) {
      setMsg({ type: 'err', text: 'Titre et consigne sont obligatoires.' });
      return;
    }
    setBusy(id ?? 'new');
    try {
      await upsertMission(id ? { ...value, id } : value);
      if (id) {
        setDrafts((p) => {
          const n = { ...p };
          delete n[id];
          return n;
        });
      } else {
        setDraftNew(EMPTY);
      }
      await load();
      setMsg({ type: 'ok', text: 'Mission enregistree.' });
    } catch (e) {
      setMsg({ type: 'err', text: errorMessage(e, 'Enregistrement impossible') });
    } finally {
      setBusy(null);
    }
  }

  async function remove(id: string) {
    setBusy(id);
    try {
      await deleteMission(id);
      await load();
    } catch (e) {
      setMsg({ type: 'err', text: errorMessage(e, 'Suppression impossible : la mission est peut-etre deja attribuee. Desactive-la plutot.') });
    } finally {
      setBusy(null);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24 text-white/30">
        <RefreshCw className="w-5 h-5 animate-spin" />
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <Link to="/settings/game" className="inline-flex items-center gap-1 text-xs text-white/40 hover:text-white/70">
        <ChevronLeft className="w-3.5 h-3.5" /> Reglages du jeu
      </Link>

      <header>
        <h1 className="text-xl font-black text-white flex items-center gap-2">
          <Target className="w-5 h-5 text-violet-400" />
          Catalogue des missions
        </h1>
        <p className="text-xs text-white/40 mt-1 leading-relaxed">
          Chaque agent recoit des missions tirees au sort parmi les actives : au lancement, puis a chaque « Missions secretes » du programme.
          Le presentateur juge automatiquement sur les traces du jeu ; passe le delai, la mission echoue.
        </p>
      </header>

      {msg && (
        <p className={`text-xs px-3 py-2 rounded-lg ${msg.type === 'ok' ? 'text-emerald-300 bg-emerald-400/5' : 'text-red-300 bg-red-400/5'}`}>
          {msg.text}
        </p>
      )}

      <section className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-5 space-y-3">
        <h2 className="text-sm font-bold text-white/60 uppercase tracking-wider flex items-center gap-2">
          <Plus className="w-4 h-4" /> Nouvelle mission
        </h2>
        <MissionForm value={draftNew} onChange={setDraftNew} />
        <button
          onClick={() => save(null, draftNew)}
          disabled={busy === 'new'}
          className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-teal-500/15 border border-teal-400/25 text-teal-300 text-xs font-bold disabled:opacity-40"
        >
          <Plus className="w-3.5 h-3.5" /> Ajouter
        </button>
      </section>

      <section className="space-y-3">
        {missions.map((m) => {
          const d = drafts[m.id];
          const value = { ...m, ...d };
          return (
            <div key={m.id} className={`rounded-2xl border p-4 space-y-3 ${m.active ? 'border-white/[0.08] bg-white/[0.02]' : 'border-white/[0.04] bg-white/[0.01] opacity-60'}`}>
              <div className="flex items-center gap-2 text-[10px] text-white/35">
                <span className="px-2 py-0.5 rounded-lg bg-white/5 border border-white/10">{KIND_LABEL[m.kind]}</span>
                <span>difficulte {m.difficulty}</span>
                {!m.active && <span>inactive</span>}
              </div>
              <MissionForm value={value} onChange={(v) => setDrafts((p) => ({ ...p, [m.id]: v }))} />
              <div className="flex items-center gap-2">
                <button
                  onClick={() => save(m.id, value)}
                  disabled={busy === m.id || !d}
                  className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-teal-500/15 border border-teal-400/25 text-teal-300 text-xs font-bold disabled:opacity-40"
                >
                  <Save className="w-3 h-3" /> Enregistrer
                </button>
                <button
                  onClick={() => remove(m.id)}
                  disabled={busy === m.id}
                  className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-red-500/10 border border-red-400/20 text-red-300 text-xs font-bold disabled:opacity-40"
                >
                  <Trash2 className="w-3 h-3" /> Supprimer
                </button>
              </div>
            </div>
          );
        })}
      </section>
    </div>
  );
}
