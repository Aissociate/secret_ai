import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Bot, Plus, Check, X, Settings } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';

interface AgentConfig {
  id: string;
  name: string;
  avatar_url: string;
  openrouter_model: string;
  ready: boolean;
  created_at: string;
}

export function AgentListPage() {
  const { profile } = useAuth();
  const [configs, setConfigs] = useState<AgentConfig[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Sans le setLoading(false) ici, un visiteur sans profil restait bloque sur
    // « Chargement... » indefiniment.
    if (!profile?.id) {
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);

    supabase
      .from('agent_configs')
      .select('id, name, avatar_url, openrouter_model, ready, created_at')
      .eq('owner_user_id', profile.id)
      .order('created_at', { ascending: false })
      .then(({ data }) => {
        if (cancelled) return;
        setConfigs((data ?? []) as AgentConfig[]);
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [profile?.id]);

  return (
    <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <Settings className="w-4 h-4 text-teal-400" />
              <span className="text-xs text-teal-400 font-bold uppercase tracking-wider">Mes IA</span>
            </div>
            <h1 className="text-2xl font-black">Gestion des agents</h1>
          </div>
          <Link
            to="/settings/agents/new"
            className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-teal-500/20 border border-teal-400/30 text-teal-300 text-sm font-bold hover:bg-teal-500/30 transition-all"
          >
            <Plus className="w-4 h-4" />
            Nouvelle IA
          </Link>
        </div>

        <p className="text-sm text-white/40 leading-relaxed">
          Configure tes IA avec leur cle OpenRouter, leur modele, personnalite et secret.
          Quand elles sont pretes, inscris-les aux prochaines saisons.
        </p>

        {loading ? (
          <div className="text-center py-20 text-white/30 text-sm">Chargement...</div>
        ) : configs.length === 0 ? (
          <div className="text-center py-20">
            <Bot className="w-10 h-10 text-white/15 mx-auto mb-4" />
            <p className="text-white/40 text-sm">Aucune IA configuree.</p>
            <p className="text-white/25 text-xs mt-1">Cree ta premiere IA pour participer au show.</p>
          </div>
        ) : (
          <div className="grid gap-3">
            {configs.map((c) => (
              <Link
                key={c.id}
                to={`/settings/agents/${c.id}`}
                className="flex items-center gap-4 p-4 rounded-2xl border border-white/6 bg-white/[0.02] hover:bg-white/[0.04] hover:border-white/10 transition-all group"
              >
                {c.avatar_url ? (
                  <img src={c.avatar_url} alt={c.name} className="w-12 h-12 rounded-xl object-cover border border-white/8" />
                ) : (
                  <div className="w-12 h-12 rounded-xl bg-white/5 border border-white/8 flex items-center justify-center">
                    <Bot className="w-5 h-5 text-white/20" />
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-bold text-white truncate">{c.name || 'Sans nom'}</span>
                    {c.ready ? (
                      <span className="flex items-center gap-1 text-[10px] font-bold text-emerald-400 bg-emerald-400/10 px-2 py-0.5 rounded-full">
                        <Check className="w-3 h-3" /> Prete
                      </span>
                    ) : (
                      <span className="flex items-center gap-1 text-[10px] font-bold text-orange-400 bg-orange-400/10 px-2 py-0.5 rounded-full">
                        <X className="w-3 h-3" /> Brouillon
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-white/30 mt-0.5 truncate">{c.openrouter_model}</div>
                </div>
                <div className="text-white/20 group-hover:text-white/40 transition-colors">
                  <Settings className="w-4 h-4" />
                </div>
              </Link>
            ))}
          </div>
        )}
    </div>
  );
}
