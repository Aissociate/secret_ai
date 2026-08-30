import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { Video, Save, Eye, EyeOff, CheckCircle, AlertCircle, Loader2 } from 'lucide-react';
import { supabase } from '../lib/supabase';

interface VideoSettings {
  id?: string;
  season_id: string;
  kie_ai_api_key: string;
  model: string;
  aspect_ratio: string;
  n_frames: string;
  remove_watermark: boolean;
  enabled: boolean;
}

interface VideoJobStats {
  total: number;
  success: number;
  fail: number;
  pending: number;
}

export function VideoSettingsPage() {
  const { seasonId } = useParams();
  const sid = seasonId!;

  const [settings, setSettings] = useState<VideoSettings>({
    season_id: sid,
    kie_ai_api_key: '',
    model: 'sora-2-image-to-video',
    aspect_ratio: 'landscape',
    n_frames: '15',
    remove_watermark: true,
    enabled: false,
  });

  const [stats, setStats] = useState<VideoJobStats>({
    total: 0,
    success: 0,
    fail: 0,
    pending: 0,
  });

  const [showApiKey, setShowApiKey] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    loadSettings();
    loadStats();
  }, [sid]);

  async function loadSettings() {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('video_generation_settings')
        .select('*')
        .eq('season_id', sid)
        .maybeSingle();

      if (error && error.code !== 'PGRST116') {
        throw error;
      }

      if (data) {
        setSettings(data);
      }
    } catch (err) {
      console.error('Error loading settings:', err);
      setMessage({ type: 'error', text: 'Erreur lors du chargement des paramètres' });
    } finally {
      setLoading(false);
    }
  }

  async function loadStats() {
    try {
      const { data: jobs, error } = await supabase
        .from('video_jobs')
        .select('status')
        .eq('season_id', sid);

      if (error) throw error;

      const stats = {
        total: jobs?.length || 0,
        success: jobs?.filter(j => j.status === 'success').length || 0,
        fail: jobs?.filter(j => j.status === 'fail').length || 0,
        pending: jobs?.filter(j => ['pending', 'queuing', 'generating'].includes(j.status)).length || 0,
      };

      setStats(stats);
    } catch (err) {
      console.error('Error loading stats:', err);
    }
  }

  async function handleSave() {
    setSaving(true);
    setMessage(null);

    try {
      if (!settings.kie_ai_api_key) {
        setMessage({ type: 'error', text: 'La clé API Kie.ai est requise' });
        return;
      }

      if (settings.id) {
        const { error } = await supabase
          .from('video_generation_settings')
          .update({
            kie_ai_api_key: settings.kie_ai_api_key,
            model: settings.model,
            aspect_ratio: settings.aspect_ratio,
            n_frames: settings.n_frames,
            remove_watermark: settings.remove_watermark,
            enabled: settings.enabled,
            updated_at: new Date().toISOString(),
          })
          .eq('id', settings.id);

        if (error) throw error;
      } else {
        const { data, error } = await supabase
          .from('video_generation_settings')
          .insert(settings)
          .select()
          .single();

        if (error) throw error;
        setSettings(data);
      }

      setMessage({ type: 'success', text: 'Paramètres sauvegardés avec succès!' });
      loadStats();
    } catch (err: any) {
      console.error('Error saving settings:', err);
      setMessage({ type: 'error', text: err.message || 'Erreur lors de la sauvegarde' });
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="w-8 h-8 text-white/40 animate-spin" />
      </div>
    );
  }

  const successRate = stats.total > 0 ? Math.round((stats.success / stats.total) * 100) : 0;

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="relative overflow-hidden rounded-2xl border border-white/[0.06] bg-gradient-to-br from-white/[0.03] via-transparent to-amber-500/[0.03] p-5 sm:p-6">
        <div className="absolute top-0 right-0 w-48 h-48 bg-amber-500/[0.04] rounded-full blur-3xl -translate-y-1/2 translate-x-1/2 pointer-events-none" />
        <div className="relative">
          <div className="flex items-center gap-2 mb-2">
            <Video className="w-4 h-4 text-amber-400" />
            <span className="text-xs font-bold text-amber-400 uppercase tracking-wider">
              Configuration
            </span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-black text-white">Génération Vidéo</h1>
          <p className="text-sm text-white/40 mt-1">
            Configurez la génération automatique de vidéos cinématographiques avec Kie.ai Sora 2
          </p>
        </div>
      </div>

      {message && (
        <div
          className={`p-4 rounded-xl border flex items-start gap-3 ${
            message.type === 'success'
              ? 'bg-green-500/[0.05] border-green-500/20'
              : 'bg-red-500/[0.05] border-red-500/20'
          }`}
        >
          {message.type === 'success' ? (
            <CheckCircle className="w-5 h-5 text-green-400 flex-shrink-0 mt-0.5" />
          ) : (
            <AlertCircle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
          )}
          <p className={`text-sm ${message.type === 'success' ? 'text-green-300' : 'text-red-300'}`}>
            {message.text}
          </p>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="p-4 rounded-xl border border-white/[0.06] bg-white/[0.02]">
          <p className="text-xs text-white/40 mb-1">Total Vidéos</p>
          <p className="text-2xl font-bold text-white">{stats.total}</p>
        </div>
        <div className="p-4 rounded-xl border border-white/[0.06] bg-white/[0.02]">
          <p className="text-xs text-white/40 mb-1">Taux de Succès</p>
          <p className="text-2xl font-bold text-green-400">{successRate}%</p>
        </div>
        <div className="p-4 rounded-xl border border-white/[0.06] bg-white/[0.02]">
          <p className="text-xs text-white/40 mb-1">En Cours</p>
          <p className="text-2xl font-bold text-amber-400">{stats.pending}</p>
        </div>
      </div>

      <div className="p-6 rounded-xl border border-white/[0.06] bg-white/[0.02] space-y-5">
        <div>
          <label className="block text-sm font-medium text-white mb-2">
            Clé API Kie.ai <span className="text-red-400">*</span>
          </label>
          <div className="relative">
            <input
              type={showApiKey ? 'text' : 'password'}
              value={settings.kie_ai_api_key}
              onChange={(e) => setSettings({ ...settings, kie_ai_api_key: e.target.value })}
              className="w-full px-4 py-2.5 bg-white/[0.03] border border-white/[0.06] rounded-lg text-white text-sm focus:outline-none focus:border-amber-500/50 transition-colors pr-10"
              placeholder="Entrez votre clé API Kie.ai"
            />
            <button
              type="button"
              onClick={() => setShowApiKey(!showApiKey)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-white/40 hover:text-white/60"
            >
              {showApiKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
          <p className="text-xs text-white/30 mt-1">
            Obtenez votre clé API sur{' '}
            <a
              href="https://kie.ai"
              target="_blank"
              rel="noopener noreferrer"
              className="text-amber-400 hover:underline"
            >
              kie.ai
            </a>
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-white mb-2">Ratio d'aspect</label>
            <select
              value={settings.aspect_ratio}
              onChange={(e) => setSettings({ ...settings, aspect_ratio: e.target.value })}
              className="w-full px-4 py-2.5 bg-white/[0.03] border border-white/[0.06] rounded-lg text-white text-sm focus:outline-none focus:border-amber-500/50"
            >
              <option value="landscape">Paysage (16:9)</option>
              <option value="portrait">Portrait (9:16)</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-white mb-2">Durée</label>
            <select
              value={settings.n_frames}
              onChange={(e) => setSettings({ ...settings, n_frames: e.target.value })}
              className="w-full px-4 py-2.5 bg-white/[0.03] border border-white/[0.06] rounded-lg text-white text-sm focus:outline-none focus:border-amber-500/50"
            >
              <option value="10">10 secondes</option>
              <option value="15">15 secondes</option>
            </select>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <input
            type="checkbox"
            id="removeWatermark"
            checked={settings.remove_watermark}
            onChange={(e) => setSettings({ ...settings, remove_watermark: e.target.checked })}
            className="w-4 h-4 rounded border-white/[0.06] bg-white/[0.03] text-amber-500 focus:ring-amber-500"
          />
          <label htmlFor="removeWatermark" className="text-sm text-white/70">
            Supprimer le filigrane
          </label>
        </div>

        <div className="flex items-center gap-3 p-4 bg-amber-500/[0.05] border border-amber-500/20 rounded-lg">
          <input
            type="checkbox"
            id="enabled"
            checked={settings.enabled}
            onChange={(e) => setSettings({ ...settings, enabled: e.target.checked })}
            className="w-4 h-4 rounded border-amber-500/20 bg-amber-500/10 text-amber-500 focus:ring-amber-500"
          />
          <label htmlFor="enabled" className="text-sm font-medium text-amber-200">
            Activer la génération automatique de vidéos
          </label>
        </div>

        <div className="pt-4 border-t border-white/[0.06]">
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-2 px-6 py-2.5 bg-amber-500 hover:bg-amber-600 text-white font-medium rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saving ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Sauvegarde...
              </>
            ) : (
              <>
                <Save className="w-4 h-4" />
                Sauvegarder
              </>
            )}
          </button>
        </div>
      </div>

      <div className="p-4 rounded-xl border border-white/[0.06] bg-white/[0.02]">
        <h3 className="text-sm font-semibold text-white mb-2">Limites et informations</h3>
        <ul className="space-y-1 text-xs text-white/50">
          <li>• Maximum 3 vidéos par agent par jour</li>
          <li>• Durée de génération: 2-5 minutes par vidéo</li>
          <li>• Types supportés: Confessionnaux, Discussions, Accusations, Messages Privés</li>
          <li>• Les vidéos sont stockées indéfiniment</li>
        </ul>
      </div>

      <div className="flex gap-3">
        <Link
          to={`/show/${sid}/videos`}
          className="px-4 py-2 bg-white/[0.03] hover:bg-white/[0.06] border border-white/[0.06] text-white text-sm font-medium rounded-lg transition-colors"
        >
          Voir la Galerie
        </Link>
      </div>
    </div>
  );
}
