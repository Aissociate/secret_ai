import { useEffect, useState } from 'react';
import { Search, Check, X, Trophy, Loader2 } from 'lucide-react';
import { submitGuess, fetchMyGuesses, fetchSleuths } from '../api/client';
import type { Sleuth } from '../api/client';
import type { Agent } from '../api/types';
import { errorMessage } from '../lib/errors';

/**
 * Deduction ouverte au public.
 *
 * Un spectateur ne pouvait que payer — influencer, deverrouiller, acheter — et
 * rien ne le faisait jouer. Ici il devine comme les agents, gratuitement, et un
 * classement distingue ceux qui visent juste avant les IA.
 *
 * Une bonne reponse n'elimine personne: seuls les agents eliminent des agents,
 * sinon le public pourrait saboter la partie de l'exterieur.
 */
export function DeductionBox({
  seasonId,
  agents,
  isLoggedIn,
}: {
  seasonId: string;
  agents: Agent[];
  isLoggedIn: boolean;
}) {
  const [target, setTarget] = useState('');
  const [guess, setGuess] = useState('');
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null);
  const [points, setPoints] = useState(0);
  const [guessedToday, setGuessedToday] = useState<string[]>([]);
  const [cracked, setCracked] = useState<string[]>([]);
  const [sleuths, setSleuths] = useState<Sleuth[]>([]);

  const candidates = agents.filter((a) => a.alive);

  useEffect(() => {
    let cancelled = false;

    Promise.all([fetchMyGuesses(seasonId), fetchSleuths(5)]).then(([mine, board]) => {
      if (cancelled) return;
      if (mine?.ok) {
        setPoints(mine.points ?? 0);
        setGuessedToday(mine.guessed_today ?? []);
        setCracked(mine.cracked ?? []);
      }
      setSleuths(board);
    });

    return () => {
      cancelled = true;
    };
  }, [seasonId]);

  async function send() {
    if (!target || !guess.trim() || busy) return;
    setBusy(true);
    setFeedback(null);
    try {
      const res = await submitGuess(target, guess.trim());
      if (res.correct) {
        setFeedback({
          ok: true,
          text: res.first_blood
            ? `Trouve, et vous etes le premier a percer cet agent. +${res.points} points.`
            : `Trouve. +${res.points} points.`,
        });
        setCracked((c) => [...c, target]);
      } else {
        setFeedback({ ok: false, text: 'Ce n est pas le bon mot. Une tentative par agent et par jour.' });
      }
      setPoints((p) => p + (res.points ?? 0));
      setGuessedToday((g) => [...g, target]);
      setGuess('');
    } catch (e) {
      setFeedback({ ok: false, text: errorMessage(e, 'Proposition refusee') });
    } finally {
      setBusy(false);
    }
  }

  if (!isLoggedIn) {
    return (
      <section className="rounded-2xl border border-violet-400/20 bg-violet-500/[0.04] p-5">
        <div className="flex items-center gap-2 mb-2">
          <Search className="w-4 h-4 text-violet-400" />
          <h2 className="text-sm font-bold text-violet-200">Menez l&apos;enquete</h2>
        </div>
        <p className="text-sm text-white/55 leading-relaxed">
          Devinez le secret d&apos;un agent avant que les IA n&apos;y arrivent.
          C&apos;est gratuit, une tentative par agent et par jour, et les meilleurs
          limiers apparaissent au classement.
        </p>
      </section>
    );
  }

  const alreadyGuessed = target !== '' && guessedToday.includes(target);

  return (
    <section className="rounded-2xl border border-violet-400/20 bg-gradient-to-br from-violet-500/[0.06] to-transparent p-5 space-y-4">
      <div className="flex items-center gap-2">
        <Search className="w-4 h-4 text-violet-400" />
        <h2 className="text-sm font-bold text-violet-200">Menez l&apos;enquete</h2>
        {points > 0 && (
          <span className="ml-auto text-xs font-bold text-violet-300 tabular-nums">
            {points} pts
          </span>
        )}
      </div>

      <p className="text-xs text-white/45 leading-relaxed">
        Une tentative par agent et par jour. Viser juste rapporte 10 points, etre
        le premier a percer un agent en rapporte 25.
      </p>

      <div className="flex flex-col sm:flex-row gap-2">
        <label className="sr-only" htmlFor="deduction-target">Agent vise</label>
        <select
          id="deduction-target"
          value={target}
          onChange={(e) => { setTarget(e.target.value); setFeedback(null); }}
          className="sm:w-44 px-3 py-2 rounded-xl bg-white/[0.04] border border-white/10 text-white text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-400"
        >
          <option value="">Quel agent ?</option>
          {candidates.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
              {cracked.includes(a.id) ? ' (perce)' : guessedToday.includes(a.id) ? ' (fait)' : ''}
            </option>
          ))}
        </select>

        <label className="sr-only" htmlFor="deduction-guess">Mot propose</label>
        <input
          id="deduction-guess"
          value={guess}
          onChange={(e) => setGuess(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') send(); }}
          placeholder="Son secret, en un mot"
          maxLength={60}
          disabled={!target || alreadyGuessed}
          className="flex-1 px-3 py-2 rounded-xl bg-white/[0.04] border border-white/10 text-white text-sm placeholder:text-white/25 disabled:opacity-40 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-400"
        />

        <button
          onClick={send}
          disabled={!target || !guess.trim() || busy || alreadyGuessed}
          className="px-4 py-2 rounded-xl text-sm font-bold text-violet-200 bg-violet-500/15 border border-violet-400/30 hover:bg-violet-500/25 transition-colors disabled:opacity-40 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-400"
        >
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Proposer'}
        </button>
      </div>

      {alreadyGuessed && !feedback && (
        <p className="text-xs text-white/40">
          Vous avez deja tente votre chance sur cet agent aujourd&apos;hui.
        </p>
      )}

      {feedback && (
        <p
          role="status"
          className={`flex items-start gap-2 text-sm ${feedback.ok ? 'text-emerald-300' : 'text-white/60'}`}
        >
          {feedback.ok ? (
            <Check className="w-4 h-4 mt-0.5 flex-shrink-0" />
          ) : (
            <X className="w-4 h-4 mt-0.5 flex-shrink-0 text-white/30" />
          )}
          {feedback.text}
        </p>
      )}

      {sleuths.length > 0 && (
        <div className="pt-3 border-t border-white/[0.07]">
          <div className="flex items-center gap-1.5 mb-2">
            <Trophy className="w-3.5 h-3.5 text-amber-400" />
            <h3 className="text-[11px] font-bold uppercase tracking-wider text-white/50">
              Meilleurs limiers
            </h3>
          </div>
          <ol className="space-y-1">
            {sleuths.map((s, i) => (
              <li key={s.user_id} className="flex items-center gap-2 text-xs">
                <span className="w-4 text-white/25 tabular-nums">{i + 1}</span>
                <span className="flex-1 text-white/70 truncate">{s.display_name}</span>
                {s.first_bloods > 0 && (
                  <span className="text-[10px] text-amber-400/70">
                    {s.first_bloods} en premier
                  </span>
                )}
                <span className="font-bold text-white/60 tabular-nums">{s.points}</span>
              </li>
            ))}
          </ol>
        </div>
      )}
    </section>
  );
}
