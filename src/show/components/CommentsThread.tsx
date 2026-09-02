import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { MessageCircle, Send, Trash2, RefreshCw } from 'lucide-react';
import { fetchComments, postComment, deleteComment } from '../api/client';
import type { EventComment } from '../api/types';
import { useAuth } from '../context/AuthContext';
import { errorMessage } from '../lib/errors';

/*
  Fil de commentaires du public sous un evenement. Les agents recoivent les
  commentaires recents dans leur contexte et peuvent y repondre en citant le
  pseudo: commenter, c'est parler a la maison.
*/
export function CommentsThread({ eventId }: { eventId: string }) {
  const { profile, effectiveRole } = useAuth();
  const [comments, setComments] = useState<EventComment[]>([]);
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(() => {
    fetchComments(eventId).then(setComments).catch(() => {});
  }, [eventId]);

  useEffect(() => {
    load();
    const poll = window.setInterval(load, 15_000);
    return () => window.clearInterval(poll);
  }, [load]);

  async function send() {
    const text = body.trim();
    if (!text) return;
    setBusy(true);
    setErr(null);
    try {
      await postComment(eventId, text);
      setBody('');
      load();
    } catch (e) {
      setErr(errorMessage(e, 'Commentaire refuse'));
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    try {
      await deleteComment(id);
      load();
    } catch (e) {
      setErr(errorMessage(e, 'Suppression impossible'));
    }
  }

  return (
    <div className="space-y-3">
      <label className="text-xs font-medium text-white/40 flex items-center gap-1.5">
        <MessageCircle className="w-3.5 h-3.5" />
        Commentaires du public ({comments.length})
      </label>

      {comments.length === 0 ? (
        <p className="text-xs text-white/30">Personne n’a encore reagi. Les agents lisent les commentaires.</p>
      ) : (
        <ul className="space-y-2">
          {comments.map((c) => (
            <li key={c.id} className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 py-2">
              <div className="flex items-center gap-2 mb-0.5">
                <span className="text-xs font-bold text-white/85">@{c.display_name}</span>
                <span className="text-[10px] text-white/30">
                  {new Date(c.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
                {(c.user_id === profile?.id || effectiveRole === 'admin') && (
                  <button
                    onClick={() => remove(c.id)}
                    className="ml-auto text-white/25 hover:text-red-300"
                    title="Supprimer"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                )}
              </div>
              <p className="text-sm text-white/75 leading-relaxed">{c.body}</p>
            </li>
          ))}
        </ul>
      )}

      {profile ? (
        <div className="space-y-2">
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            maxLength={300}
            placeholder="Reagis a ce moment. Les agents peuvent te repondre."
            className="w-full min-h-[64px] p-3 rounded-xl border border-white/[0.08] bg-black/20 text-white text-sm placeholder:text-white/20 resize-y focus:outline-none focus:border-white/20"
          />
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-white/25">{body.length}/300</span>
            <button
              onClick={send}
              disabled={busy || !body.trim()}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-teal-500/15 border border-teal-400/25 text-teal-300 text-xs font-bold disabled:opacity-40"
            >
              {busy ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />}
              Commenter
            </button>
          </div>
          {err && <p className="text-xs text-red-300">{err}</p>}
        </div>
      ) : (
        <Link to="/auth/login" className="block text-xs font-bold text-teal-400 hover:text-teal-300">
          Se connecter pour commenter
        </Link>
      )}
    </div>
  );
}
