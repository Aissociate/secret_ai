import { lazy, Suspense } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { ShowLayout } from './ShowLayout';
import { BaseLayout } from './BaseLayout';
import { RequireAuth } from './components/RequireAuth';
import { LivePage } from './pages/LivePage';
import { AgentPage } from './pages/AgentPage';
import { LoginPage } from './auth/LoginPage';
import { RegisterPage } from './auth/RegisterPage';

/*
  Les pages secondaires et d'administration sont chargees a la demande: elles
  representaient l'essentiel du bundle initial servi a tous les visiteurs.
*/
const ConfessionalsPage = lazy(() =>
  import('./pages/ConfessionalsPage').then((m) => ({ default: m.ConfessionalsPage }))
);
const SuspicionPage = lazy(() =>
  import('./pages/SuspicionPage').then((m) => ({ default: m.SuspicionPage }))
);
const HintsPage = lazy(() =>
  import('./pages/HintsPage').then((m) => ({ default: m.HintsPage }))
);
const DiaryPage = lazy(() =>
  import('./pages/DiaryPage').then((m) => ({ default: m.DiaryPage }))
);
const VideosGalleryPage = lazy(() =>
  import('./pages/VideosGalleryPage').then((m) => ({ default: m.VideosGalleryPage }))
);
const SeasonDraftPage = lazy(() =>
  import('./pages/SeasonDraftPage').then((m) => ({ default: m.SeasonDraftPage }))
);
const AgentListPage = lazy(() =>
  import('./pages/AgentListPage').then((m) => ({ default: m.AgentListPage }))
);
const AgentSettingsPage = lazy(() =>
  import('./pages/AgentSettingsPage').then((m) => ({ default: m.AgentSettingsPage }))
);
const AgentCareerPage = lazy(() =>
  import('./pages/AgentCareerPage').then((m) => ({ default: m.AgentCareerPage }))
);
const GameSettingsPage = lazy(() =>
  import('./pages/GameSettingsPage').then((m) => ({ default: m.GameSettingsPage }))
);
const ChallengePage = lazy(() =>
  import('./pages/ChallengePage').then((m) => ({ default: m.ChallengePage }))
);
const AccountSettingsPage = lazy(() =>
  import('./pages/AccountSettingsPage').then((m) => ({ default: m.AccountSettingsPage }))
);
const HostSettingsPage = lazy(() =>
  import('./pages/HostSettingsPage').then((m) => ({ default: m.HostSettingsPage }))
);
const VideoSettingsPage = lazy(() =>
  import('./pages/VideoSettingsPage').then((m) => ({ default: m.VideoSettingsPage }))
);

function RouteFallback() {
  return (
    <div className="flex items-center justify-center py-24">
      <div className="w-6 h-6 rounded-full border-2 border-white/20 border-t-teal-400 animate-spin" />
      <span className="sr-only">Chargement de la page</span>
    </div>
  );
}

export function ShowRouter() {
  return (
    <Suspense fallback={<RouteFallback />}>
      <Routes>
        <Route element={<BaseLayout />}>
          <Route path="/auth/login" element={<LoginPage />} />
          <Route path="/auth/register" element={<RegisterPage />} />

          {/*
            SeasonDraftPage gere explicitement le visiteur anonyme (la policy
            « Anon can view draft seasons » existe pour ca) et sert de page
            d'accueil: la placer derriere une garde renvoyait tout visiteur non
            connecte vers /auth/login.
          */}
          <Route path="/seasons" element={<SeasonDraftPage />} />

          {/*
            Fiche publique d'agent, a URL stable: c'est l'objet d'identite que
            l'on partage, il doit rester accessible sans compte.
          */}
          <Route path="/agents/:configId" element={<AgentCareerPage />} />

          {/*
            Lien de defi: lisible sans compte, sinon l'affront ne porte pas.
          */}
          <Route path="/defi/:token" element={<ChallengePage />} />

          <Route element={<RequireAuth />}>
            <Route path="/settings/account" element={<AccountSettingsPage />} />
          </Route>

          <Route element={<RequireAuth roles={['admin']} />}>
            <Route path="/settings/game" element={<GameSettingsPage />} />
          </Route>

          <Route element={<RequireAuth roles={['owner', 'admin']} />}>
            <Route path="/settings/agents" element={<AgentListPage />} />
            <Route path="/settings/agents/:configId" element={<AgentSettingsPage />} />
          </Route>
        </Route>

        <Route path="/show/:seasonId" element={<ShowLayout />}>
          <Route path="live" element={<LivePage />} />
          <Route path="agent/:agentId" element={<AgentPage />} />
          <Route path="agent/:agentId/diary" element={<DiaryPage />} />
          <Route path="confessionals" element={<ConfessionalsPage />} />
          <Route path="suspicion" element={<SuspicionPage />} />
          <Route path="hints" element={<HintsPage />} />
          <Route path="videos" element={<VideosGalleryPage />} />

          {/* Reglages sensibles: cles de generation, configuration du presentateur. */}
          <Route element={<RequireAuth roles={['admin']} />}>
            <Route path="host-settings" element={<HostSettingsPage />} />
            <Route path="settings/video" element={<VideoSettingsPage />} />
          </Route>

          <Route index element={<Navigate to="live" replace />} />
        </Route>

        <Route path="/" element={<Navigate to="/seasons" replace />} />
        <Route path="*" element={<Navigate to="/seasons" replace />} />
      </Routes>
    </Suspense>
  );
}
