import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { CalendarDays, Plus, Save, Trash2, Target, CheckCircle, XCircle, RefreshCw, Sparkles, Scale } from 'lucide-react';
import {
  fetchSeason, fetchAgents, fetchProgram, upsertProgramRow, deleteProgramRow,
  seedDefaultProgram, fetchAgentMissions,
} from '../api/client';
import type { Agent, AgentMission, ProgramRow, ProgramSlot, Season } from '../api/types';
import { useAuth } from '../context/AuthContext';
import { errorMessage } from '../lib/errors';

const SLOT_LABEL: Record<ProgramSlot, string> = {
  secret_drop: 'Missions secretes',
  challenge: 'Defi',
  confession_room: 'Confessionnal du public',
  twist: 'Twist',
  nominations: 'Nominations',
  vote: 'Vote',
  eviction: 'Eviction',
  custom: 'Evenement',
};

const SLOT_COLOR: Record<ProgramSlot, string> = {
  secret_drop: 'text-violet-300 bg-violet-500/10 border-violet-400/20',
  challenge: 'text-sky-300 bg-sky-500/10 border-sky-400/20',
  confession_room: 'text-amber-300 bg-amber-500/10 border-amber-400/20',
  twist: 'text-fuchsia-300 bg-fuchsia-500/10 border-fuchsia-400/20',
  nominations: 'text-orange-300 bg-orange-500/10 border-orange-400/20',
  vote: 'text-teal-300 bg-teal-500/10 border-teal-400/20',
  eviction: 'text-red-300 bg-red-500/10 border-red-400/20',
  custom: 'text-white/70 bg-white/5 border-white/10',
};

const STATUS_LABEL: Record<ProgramRow['status'], string> = {
  planned: 'A venir',
  announced: 'En cours',
  done: 'Termine',
};

const inputCls =
  'w-full px-3 py-2 rounded-xl bg-white/[0.04] border border-white/10 text-white text-sm focus:outline-none focus:border-teal-400/40';

/*
  Programme de la saison et missions secretes.

  Pour tout le monde: le calendrier des evenements (ce qui attend la maison
  chaque jour) et les missions deja revelees. Pour l'admin: edition du
  programme et resolution des missions en cours, avec l'effet sur la
  popularite et la reputation annonce dans le fil.
*/
export function ProgramPage() {
  const { seasonId } = useParams();
  const sid = seasonId!;
  const { effectiveRole } = useAuth();
  const isAdmin = effectiveRole === 'admin';

  const [season, setSeason] = useState<Season | null>(null);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [rows, setRows] = useState<ProgramRow[]>([]);
  const [missions, setMissions] = useState<AgentMission[]>([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  const [drafts, setDrafts] = useState<Record<string, Partial<ProgramRow>>>({});
  const [newRow, setNewRow] = useState<Partial<ProgramRow>>({ day_number: 1, slot: 'custom', title: '', description: '' });
  const [busyId, setBusyId] = useState<string | null>(null);

  async function load() {
    const [s, a, p, m] = await Promise.all([
      fetchSeason(sid),
      fetchAgents(sid),
      fetchProgram(sid),
      fetchAgentMissions(sid),
    ]);
    setSeason(s);
    setAgents(a);
    setRows(p);
    setMissions(m);
  }

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    load()
      .catch((e) => !cancelled && setMsg({ type: 'err', text: errorMessage(e, 'Chargement impossible') }))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sid]);

  const agentMap = useMemo(() => new Map(agents.map((a) => [a.id, a])), [agents]);
  const byDay = useMemo(() => {
    const m = new Map<number, ProgramRow[]>();
    for (const r of [...rows].sort((a, b) => a.day_number - b.day_number)) {
      m.set(r.day_number, [...(m.get(r.day_number) ?? []), r]);
    }
    return m;
  }, [rows]);

  const revealed = missions.filter((m) => m.revealed);
  const active = missions.filter((m) => m.status === 'active');

  async function saveRow(row: ProgramRow) {
    const d = drafts[row.id] ?? {};
    setBusyId(row.id);
    try {
      await upsertProgramRow({ ...row, ...d });
      setDrafts((prev) => {
        const next = { ...prev };
        delete next[row.id];
        return next;
      });
      await load();
      setMsg({ type: 'ok', text: 'Evenement enregistre.' });
    } catch (e) {
      setMsg({ type: 'err', text: errorMessage(e, 'Enregistrement impossible') });
    } finally {
      setBusyId(null);
    }
  }

  async function removeRow(id: string) {
    setBusyId(id);
    try {
      await deleteProgramRow(id);
      await load();
    } catch (e) {
      setMsg({ type: 'err', text: errorMessage(e, 'Suppression impossible') });
    } finally {
      setBusyId(null);
    }
  }

  async function addRow() {
    if (!newRow.title?.trim()) {
      setMsg({ type: 'err', text: 'Donne un titre a l’evenement.' });
      return;
    }
    setBusyId('new');
    try {
      await upsertProgramRow({ ...newRow, season_id: sid });
      setNewRow({ day_number: newRow.day_number, slot: 'custom', title: '', description: '' });
      await load();
      setMsg({ type: 'ok', text: 'Evenement ajoute.' });
    } catch (e) {
      setMsg({ type: 'err', text: errorMessage(e, 'Ajout impossible') });
    } finally {
      setBusyId(null);
    }
  }

  async function seed() {
    setBusyId('seed');
    try {
      const n = await seedDefaultProgram(sid);
      await load();
      setMsg({ type: 'ok', text: n > 0 ? `${n} evenements crees.` : 'Le programme existe deja : supprime-le d’abord pour le regenerer.' });
    } catch (e) {
      setMsg({ type: 'err', text: errorMessage(e, 'Generation impossible') });
    } finally {
      setBusyId(null);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24 text-white/30">
        <RefreshCw className="w-5 h-5 animate-spin" />
      </div>
    );
  }

  const days = Math.max(season?.duration_days ?? 7, ...Array.from(byDay.keys()), 1);

  return (
    <div className="space-y-8">
      <header className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-black text-white flex items-center gap-2">
            <CalendarDays className="w-5 h-5 text-teal-400" />
            Programme de la saison
          </h1>
          <p className="text-xs text-white/40 mt-1 leading-relaxed">
            Ce qui attend la maison jour apres jour. Le presentateur annonce chaque evenement et les agents en tiennent compte.
          </p>
        </div>
        {isAdmin && rows.length === 0 && (
          <button
            onClick={seed}
            disabled={busyId === 'seed'}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-teal-500/15 border border-teal-400/25 text-teal-300 text-xs font-bold hover:bg-teal-500/25 disabled:opacity-40"
          >
            <Sparkles className="w-3.5 h-3.5" />
            Generer le programme par defaut
          </button>
        )}
      </header>

      {msg && (
        <p className={`text-xs px-3 py-2 rounded-lg ${msg.type === 'ok' ? 'text-emerald-300 bg-emerald-400/5' : 'text-red-300 bg-red-400/5'}`}>
          {msg.text}
        </p>
      )}

      <section className="space-y-3">
        {Array.from({ length: days }, (_, i) => i + 1).map((day) => {
          const dayRows = byDay.get(day) ?? [];
          const isToday = season?.current_day === day;
          return (
            <div
              key={day}
              className={`rounded-2xl border p-4 ${isToday ? 'border-teal-400/30 bg-teal-500/[0.04]' : 'border-white/[0.06] bg-white/[0.015]'}`}
            >
              <div className="flex items-center gap-3 mb-3">
                <span className={`w-9 h-9 rounded-xl flex items-center justify-center text-xs font-black ${isToday ? 'bg-teal-500/20 text-teal-300' : 'bg-white/5 text-white/50'}`}>
                  J{day}
                </span>
                {isToday && <span className="text-[10px] font-bold uppercase tracking-wider text-teal-300">Aujourd’hui</span>}
                {dayRows.length === 0 && <span className="text-xs text-white/30">Journee libre.</span>}
              </div>

              <div className="space-y-2">
                {dayRows.map((row) => {
                  const d = drafts[row.id];
                  const edit = isAdmin;
                  const value = { ...row, ...d };
                  return (
                    <div key={row.id} className="rounded-xl border border-white/[0.06] bg-black/20 p-3 space-y-2">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-lg border ${SLOT_COLOR[value.slot as ProgramSlot] ?? SLOT_COLOR.custom}`}>
                          {SLOT_LABEL[value.slot as ProgramSlot] ?? value.slot}
                        </span>
                        <span className="text-[10px] text-white/35">{STATUS_LABEL[row.status]}</span>
                        {edit ? (
                          <input
                            className={`${inputCls} flex-1 min-w-[12rem]`}
                            value={value.title}
                            onChange={(e) => setDrafts((p) => ({ ...p, [row.id]: { ...p[row.id], title: e.target.value } }))}
                          />
                        ) : (
                          <span className="text-sm font-bold text-white">{value.title}</span>
                        )}
                      </div>
                      {edit ? (
                        <>
                          <textarea
                            className={`${inputCls} min-h-[64px]`}
                            value={value.description}
                            onChange={(e) => setDrafts((p) => ({ ...p, [row.id]: { ...p[row.id], description: e.target.value } }))}
                          />
                          <div className="flex items-center gap-2 flex-wrap">
                            <select
                              className={`${inputCls} w-auto`}
                              value={value.slot}
                              onChange={(e) => setDrafts((p) => ({ ...p, [row.id]: { ...p[row.id], slot: e.target.value as ProgramSlot } }))}
                            >
                              {(Object.keys(SLOT_LABEL) as ProgramSlot[]).map((s) => (
                                <option key={s} value={s}>{SLOT_LABEL[s]}</option>
                              ))}
                            </select>
                            <input
                              type="number"
                              min={1}
                              className={`${inputCls} w-20`}
                              value={value.day_number}
                              onChange={(e) => setDrafts((p) => ({ ...p, [row.id]: { ...p[row.id], day_number: Number(e.target.value) } }))}
                            />
                            <button
                              onClick={() => saveRow(row)}
                              disabled={busyId === row.id || !d}
                              className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-teal-500/15 border border-teal-400/25 text-teal-300 text-xs font-bold disabled:opacity-40"
                            >
                              <Save className="w-3 h-3" /> Enregistrer
                            </button>
                            <button
                              onClick={() => removeRow(row.id)}
                              disabled={busyId === row.id}
                              className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-red-500/10 border border-red-400/20 text-red-300 text-xs font-bold disabled:opacity-40"
                            >
                              <Trash2 className="w-3 h-3" /> Supprimer
                            </button>
                          </div>
                        </>
                      ) : (
                        value.description && <p className="text-xs text-white/55 leading-relaxed">{value.description}</p>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </section>

      {isAdmin && (
        <section className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-5 space-y-3">
          <h2 className="text-sm font-bold text-white/60 uppercase tracking-wider flex items-center gap-2">
            <Plus className="w-4 h-4" /> Ajouter un evenement
          </h2>
          <div className="grid sm:grid-cols-4 gap-3">
            <input
              type="number"
              min={1}
              className={inputCls}
              value={newRow.day_number ?? 1}
              onChange={(e) => setNewRow((r) => ({ ...r, day_number: Number(e.target.value) }))}
              placeholder="Jour"
            />
            <select
              className={inputCls}
              value={newRow.slot ?? 'custom'}
              onChange={(e) => setNewRow((r) => ({ ...r, slot: e.target.value as ProgramSlot }))}
            >
              {(Object.keys(SLOT_LABEL) as ProgramSlot[]).map((s) => (
                <option key={s} value={s}>{SLOT_LABEL[s]}</option>
              ))}
            </select>
            <input
              className={`${inputCls} sm:col-span-2`}
              value={newRow.title ?? ''}
              onChange={(e) => setNewRow((r) => ({ ...r, title: e.target.value }))}
              placeholder="Titre"
            />
          </div>
          <textarea
            className={`${inputCls} min-h-[64px]`}
            value={newRow.description ?? ''}
            onChange={(e) => setNewRow((r) => ({ ...r, description: e.target.value }))}
            placeholder="Consigne pour la maison : regle du twist, theme du defi, question du public..."
          />
          <button
            onClick={addRow}
            disabled={busyId === 'new'}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-teal-500/15 border border-teal-400/25 text-teal-300 text-xs font-bold disabled:opacity-40"
          >
            <Plus className="w-3.5 h-3.5" /> Ajouter
          </button>
        </section>
      )}

      <section className="space-y-3">
        <h2 className="text-sm font-bold text-white flex items-center gap-2">
          <Target className="w-4 h-4 text-violet-400" />
          Missions secretes
        </h2>

        {isAdmin && (
          <div className="rounded-2xl border border-violet-400/15 bg-violet-500/[0.04] p-4 space-y-3">
            <p className="text-xs text-white/45 leading-relaxed flex items-start gap-2">
              <Scale className="w-3.5 h-3.5 text-violet-300 mt-0.5 flex-shrink-0" />
              Missions en cours, visibles de l’admin seulement. Le presentateur les juge automatiquement
              sur les traces du jeu, toutes les 30 minutes ; passe le delai, la mission echoue.
            </p>
            {active.length === 0 && <p className="text-xs text-white/30">Aucune mission en cours.</p>}
            {active.map((am) => {
              const agent = agentMap.get(am.agent_id);
              const deadline = am.assigned_day + (am.mission?.duration_days ?? 3) - 1;
              return (
                <div key={am.id} className="rounded-xl border border-white/[0.06] bg-black/20 p-3 space-y-1.5">
                  <div className="flex items-center gap-2 flex-wrap">
                    {agent && <img src={agent.avatar_url} alt={agent.name} className="w-6 h-6 rounded-md object-cover" />}
                    <span className="text-sm font-bold text-white">{agent?.name ?? '?'}</span>
                    <span className="text-xs text-violet-300 font-semibold">« {am.mission?.title} »</span>
                    <span className="text-[10px] text-white/30">J{am.assigned_day} → J{deadline}</span>
                  </div>
                  <p className="text-xs text-white/55 leading-relaxed">{am.mission?.brief}</p>
                  {am.judge_note && (
                    <p className="text-[11px] text-white/40 italic">
                      Dernier avis du juge : {am.judge_note}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        )}

        <div className="rounded-2xl border border-white/[0.06] bg-white/[0.015] p-4 space-y-2">
          <p className="text-xs text-white/40">Missions revelees</p>
          {revealed.length === 0 && <p className="text-xs text-white/30">Aucune mission revelee pour l’instant. Chaque agent en porte au moins une.</p>}
          {revealed.map((am) => {
            const agent = agentMap.get(am.agent_id);
            const ok = am.status === 'success';
            return (
              <div key={am.id} className="flex items-start gap-2.5 text-xs">
                {ok ? <CheckCircle className="w-3.5 h-3.5 text-emerald-400 mt-0.5" /> : <XCircle className="w-3.5 h-3.5 text-red-400 mt-0.5" />}
                <div>
                  <span className="font-bold text-white/90">{agent?.name ?? '?'}</span>
                  <span className="text-white/50"> · « {am.mission?.title} » · {ok ? 'reussie' : 'echouee'}{am.resolved_day ? ` J${am.resolved_day}` : ''}</span>
                  <p className="text-white/40 leading-relaxed">{am.mission?.brief}</p>
                  {am.resolved_note && <p className="text-white/35 italic">{am.resolved_note}</p>}
                </div>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
