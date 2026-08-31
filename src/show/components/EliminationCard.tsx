import { useState } from 'react';
import { Download, Check, Share2 } from 'lucide-react';

export type EliminationCardData = {
  /** Agent elimine. */
  agentName: string;
  /** Secret revele par l'elimination. */
  secret?: string | null;
  /** Agent qui a devine, absent si elimination par ceremonie. */
  byName?: string | null;
  /** 'secret_guessed' | 'ceremony_lowest_popularity' */
  reason?: string | null;
  dayNumber: number;
  createdAt: string;
  agentsRemaining?: number | null;
  prizePool?: number | null;
  seasonTitle?: string;
};

const W = 1080;
const H = 1350;

/**
 * Carte d'elimination.
 *
 * C'est l'objet partageable du jeu: elle raconte une histoire complete (un mot
 * cache, quelqu'un qui l'a trouve), ne demande aucun contexte, et credite un
 * joueur — ce qui donne a son proprietaire une raison de la diffuser.
 *
 * L'export est dessine sur un canvas plutot que capture depuis le DOM: pas de
 * dependance externe, et un format vertical fixe adapte aux reseaux.
 */
export function EliminationCard({ data }: { data: EliminationCardData }) {
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  const guessed = data.reason === 'secret_guessed' && Boolean(data.byName);
  const verdict = guessed ? 'Secret perce' : 'Vote du public';
  const time = new Date(data.createdAt).toLocaleTimeString('fr-FR', {
    hour: '2-digit',
    minute: '2-digit',
  });

  async function exportPng() {
    setBusy(true);
    try {
      const canvas = document.createElement('canvas');
      canvas.width = W;
      canvas.height = H;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      // Fond: degrade sombre a dominante rouge, comme la carte a l'ecran.
      const bg = ctx.createLinearGradient(0, 0, W, H);
      bg.addColorStop(0, '#1A0F14');
      bg.addColorStop(0.55, '#12141C');
      bg.addColorStop(1, '#0D0F16');
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, W, H);

      const glow = ctx.createRadialGradient(W * 0.85, 0, 0, W * 0.85, 0, W * 0.9);
      glow.addColorStop(0, 'rgba(255,61,74,0.20)');
      glow.addColorStop(1, 'rgba(255,61,74,0)');
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, W, H);

      ctx.strokeStyle = 'rgba(255,61,74,0.30)';
      ctx.lineWidth = 3;
      ctx.strokeRect(1.5, 1.5, W - 3, H - 3);

      const pad = 90;
      let y = 210;

      ctx.textBaseline = 'alphabetic';

      // Verdict
      ctx.fillStyle = '#FF3D4A';
      ctx.font = '700 34px Archivo, Inter, system-ui, sans-serif';
      ctx.letterSpacing = '6px';
      ctx.fillText(verdict.toUpperCase(), pad, y);
      ctx.letterSpacing = '0px';

      // Nom de l'agent elimine
      y += 108;
      ctx.fillStyle = '#F3F0E8';
      ctx.font = '800 96px Archivo, Inter, system-ui, sans-serif';
      ctx.fillText(data.agentName, pad, y);

      y += 62;
      ctx.fillStyle = '#98A0B0';
      ctx.font = '500 40px Archivo, Inter, system-ui, sans-serif';
      ctx.fillText('quitte la Maison', pad, y);

      // Bloc du secret
      if (data.secret) {
        y += 110;
        const boxH = 230;
        ctx.fillStyle = 'rgba(0,0,0,0.42)';
        ctx.fillRect(pad, y, W - pad * 2, boxH);
        ctx.fillStyle = '#FF3D4A';
        ctx.fillRect(pad, y, 7, boxH);

        ctx.fillStyle = '#5E6879';
        ctx.font = '500 28px "DM Mono", ui-monospace, monospace';
        ctx.letterSpacing = '5px';
        ctx.fillText('SON SECRET ETAIT', pad + 46, y + 74);
        ctx.letterSpacing = '0px';

        ctx.fillStyle = '#F3F0E8';
        ctx.font = '800 76px Archivo, Inter, system-ui, sans-serif';
        ctx.fillText(truncate(ctx, data.secret, W - pad * 2 - 92), pad + 46, y + 168);
        y += boxH;
      }

      // Attribution
      if (guessed && data.byName) {
        y += 116;
        ctx.fillStyle = '#98A0B0';
        ctx.font = '400 38px Archivo, Inter, system-ui, sans-serif';
        ctx.fillText('Demasquee par', pad, y);
        y += 66;
        ctx.fillStyle = '#E8963A';
        ctx.font = '700 58px Archivo, Inter, system-ui, sans-serif';
        ctx.fillText(data.byName, pad, y);
      } else {
        y += 116;
        ctx.fillStyle = '#98A0B0';
        ctx.font = '400 38px Archivo, Inter, system-ui, sans-serif';
        ctx.fillText('Eliminee par le vote du public', pad, y);
      }

      // Pied de carte
      ctx.strokeStyle = 'rgba(255,255,255,0.09)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(pad, H - 168);
      ctx.lineTo(W - pad, H - 168);
      ctx.stroke();

      ctx.fillStyle = '#5E6879';
      ctx.font = '500 28px "DM Mono", ui-monospace, monospace';
      ctx.fillText(`JOUR ${data.dayNumber} · ${time}`, pad, H - 108);

      const right: string[] = [];
      if (data.agentsRemaining != null) right.push(`${data.agentsRemaining} restants`);
      if (data.prizePool != null) right.push(`${Math.round(data.prizePool)} USDC`);
      if (right.length) {
        const label = right.join(' · ');
        const w = ctx.measureText(label).width;
        ctx.fillText(label, W - pad - w, H - 108);
      }

      ctx.fillStyle = '#3A4252';
      ctx.font = '700 26px Archivo, Inter, system-ui, sans-serif';
      ctx.letterSpacing = '7px';
      ctx.fillText((data.seasonTitle ?? 'LA MAISON DES SECRETS').toUpperCase(), pad, H - 56);
      ctx.letterSpacing = '0px';

      const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/png'));
      if (!blob) return;

      const file = new File([blob], `elimination-${data.agentName.toLowerCase()}.png`, {
        type: 'image/png',
      });

      // Partage natif quand le navigateur le propose, telechargement sinon.
      const nav = navigator as Navigator & {
        canShare?: (d: { files: File[] }) => boolean;
        share?: (d: { files: File[]; title?: string }) => Promise<void>;
      };
      if (nav.canShare?.({ files: [file] }) && nav.share) {
        await nav.share({ files: [file], title: `${data.agentName} est eliminee` });
      } else {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = file.name;
        a.click();
        URL.revokeObjectURL(url);
      }

      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="relative overflow-hidden rounded-xl border border-red-500/25 bg-gradient-to-br from-red-950/40 via-[#12141c] to-[#0d0f16] p-6">
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            'radial-gradient(420px 220px at 88% -18%, rgba(255,61,74,.20), transparent 66%)',
        }}
      />

      <div className="relative">
        <div className="flex items-start justify-between gap-4 mb-5">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[.16em] text-red-400 mb-1.5">
              {verdict}
            </p>
            <h3 className="text-3xl font-extrabold tracking-tight text-white leading-none">
              {data.agentName} est eliminee
            </h3>
          </div>
          <span className="text-[11px] font-mono text-white/30 whitespace-nowrap pt-1">
            J{data.dayNumber} · {time}
          </span>
        </div>

        {data.secret && (
          <div className="my-5 py-4 px-5 bg-black/40 border-l-[3px] border-red-500 rounded-r">
            <span className="block text-[10px] font-mono uppercase tracking-[.16em] text-white/30 mb-1.5">
              Son secret etait
            </span>
            <span className="text-2xl font-extrabold tracking-tight text-white break-all">
              {data.secret}
            </span>
          </div>
        )}

        {(data.agentsRemaining != null || data.prizePool != null) && (
          <div className="flex items-center gap-4 mb-4 text-[11px] font-mono text-white/40">
            {data.agentsRemaining != null && (
              <span>
                <b className="text-white/70">{data.agentsRemaining}</b> encore en lice
              </span>
            )}
            {data.prizePool != null && (
              <span>
                <b className="text-amber-400">{Math.round(data.prizePool)}</b> USDC en jeu
              </span>
            )}
          </div>
        )}

        <div className="flex items-center gap-3 pt-4 border-t border-white/[0.07]">
          <p className="text-sm text-white/60 flex-1">
            {guessed ? (
              <>
                Demasquee par{' '}
                <b className="text-amber-400 font-semibold">{data.byName}</b>.
              </>
            ) : (
              'Eliminee par le vote du public.'
            )}
          </p>

          <button
            onClick={exportPng}
            disabled={busy}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-bold text-white/80 bg-white/[0.06] border border-white/10 hover:bg-white/[0.11] transition-colors disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-400"
          >
            {saved ? (
              <><Check className="w-3.5 h-3.5 text-emerald-400" /> Pret</>
            ) : (
              <>
                {typeof navigator !== 'undefined' && 'share' in navigator ? (
                  <Share2 className="w-3.5 h-3.5" />
                ) : (
                  <Download className="w-3.5 h-3.5" />
                )}
                Partager
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Reduit un texte jusqu'a tenir dans la largeur donnee. */
function truncate(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let s = text;
  while (s.length > 1 && ctx.measureText(s + '…').width > maxWidth) {
    s = s.slice(0, -1);
  }
  return s + '…';
}
