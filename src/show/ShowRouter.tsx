import { Routes, Route, Navigate } from 'react-router-dom';
import { ShowLayout } from './ShowLayout';
import { BaseLayout } from './BaseLayout';
import { LivePage } from './pages/LivePage';
import { AgentPage } from './pages/AgentPage';
import { ConfessionalsPage } from './pages/ConfessionalsPage';
import { SuspicionPage } from './pages/SuspicionPage';
import { HintsPage } from './pages/HintsPage';
import { AgentListPage } from './pages/AgentListPage';
import { AgentSettingsPage } from './pages/AgentSettingsPage';
import { SeasonDraftPage } from './pages/SeasonDraftPage';
import { HostSettingsPage } from './pages/HostSettingsPage';
import { DiaryPage } from './pages/DiaryPage';
import { VideoSettingsPage } from './pages/VideoSettingsPage';
import { VideosGalleryPage } from './pages/VideosGalleryPage';
import { AccountSettingsPage } from './pages/AccountSettingsPage';
import { LoginPage } from './auth/LoginPage';
import { RegisterPage } from './auth/RegisterPage';

export function ShowRouter() {
  return (
    <Routes>
      <Route element={<BaseLayout />}>
        <Route path="/seasons" element={<SeasonDraftPage />} />
        <Route path="/settings/account" element={<AccountSettingsPage />} />
        <Route path="/settings/agents" element={<AgentListPage />} />
        <Route path="/settings/agents/:configId" element={<AgentSettingsPage />} />
        <Route path="/auth/login" element={<LoginPage />} />
        <Route path="/auth/register" element={<RegisterPage />} />
      </Route>

      <Route path="/show/:seasonId" element={<ShowLayout />}>
        <Route path="live" element={<LivePage />} />
        <Route path="agent/:agentId" element={<AgentPage />} />
        <Route path="agent/:agentId/diary" element={<DiaryPage />} />
        <Route path="confessionals" element={<ConfessionalsPage />} />
        <Route path="suspicion" element={<SuspicionPage />} />
        <Route path="hints" element={<HintsPage />} />
        <Route path="host-settings" element={<HostSettingsPage />} />
        <Route path="videos" element={<VideosGalleryPage />} />
        <Route path="settings/video" element={<VideoSettingsPage />} />
        <Route index element={<Navigate to="live" replace />} />
      </Route>

      <Route path="/" element={<Navigate to="/seasons" replace />} />
      <Route path="*" element={<Navigate to="/seasons" replace />} />
    </Routes>
  );
}
