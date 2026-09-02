import { Link, Outlet, useParams, useLocation } from 'react-router-dom';
import { Radio, Video, AlertTriangle, Key, Eye, LogOut, Settings, Calendar, User, Menu, X, Mic, CalendarDays } from 'lucide-react';
import { useState, useRef, useEffect } from 'react';
import { useAuth } from './context/AuthContext';
import { ViewAsSelector } from './components/ViewAsSelector';

const navItems = [
  { suffix: 'live', label: 'Live', icon: Radio },
  { suffix: 'confessionals', label: 'Confessionnaux', icon: Video },
  { suffix: 'suspicion', label: 'Soupcons', icon: AlertTriangle },
  { suffix: 'hints', label: 'Indices', icon: Key },
  { suffix: 'program', label: 'Programme', icon: CalendarDays },
];

export function ShowLayout() {
  const { seasonId } = useParams();
  const location = useLocation();
  const { profile, signOut, effectiveRole, viewAsRole } = useAuth();
  const sid = seasonId ?? 'demo';
  const [menuOpen, setMenuOpen] = useState(false);
  const [mobileNav, setMobileNav] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  useEffect(() => {
    setMobileNav(false);
  }, [location.pathname]);

  return (
    <div className="min-h-screen bg-[#08090d] text-white flex flex-col">
      <header className="sticky top-0 z-30 border-b border-white/[0.06] glass">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between">
          <Link to={`/show/${sid}/live`} className="flex items-center gap-2.5 group">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-red-500 to-orange-500 flex items-center justify-center shadow-lg shadow-red-500/20">
              <Eye className="w-4 h-4 text-white" />
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-[0.15em] text-white/40 font-semibold leading-none">
                Secret House
              </div>
              <div className="text-sm font-bold text-white leading-tight flex items-center gap-2">
                <span>Season</span>
                <span className="relative flex items-center gap-1">
                  <span className="relative w-1.5 h-1.5 rounded-full bg-red-400 live-dot text-red-400" />
                  <span className="text-[10px] font-bold text-red-400 uppercase">Live</span>
                </span>
              </div>
            </div>
          </Link>

          <nav className="hidden md:flex items-center gap-1">
            {navItems.map(({ suffix, label, icon: Icon }) => {
              const to = `/show/${sid}/${suffix}`;
              const active = location.pathname.includes(`/${suffix}`);
              return (
                <Link
                  key={suffix}
                  to={to}
                  className={`
                    flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium transition-all duration-200
                    ${active
                      ? 'bg-white/10 text-white shadow-sm'
                      : 'text-white/40 hover:text-white/70 hover:bg-white/5'
                    }
                  `}
                >
                  <Icon className={`w-3.5 h-3.5 ${active && suffix === 'live' ? 'animate-pulse text-red-400' : ''}`} />
                  {label}
                </Link>
              );
            })}

            <div className="w-px h-6 bg-white/[0.06] mx-2" />

            {profile ? (
              <div className="relative" ref={menuRef}>
                <button
                  onClick={() => setMenuOpen(!menuOpen)}
                  className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium text-white/50 hover:text-white/80 hover:bg-white/5 transition-all"
                >
                  <div className="w-6 h-6 rounded-full bg-gradient-to-br from-teal-500/30 to-teal-600/30 border border-teal-400/20 flex items-center justify-center">
                    <User className="w-3 h-3 text-teal-300" />
                  </div>
                  <span>{profile.username}</span>
                  <span className="text-[9px] font-bold uppercase tracking-wider text-teal-400/60">
                    {effectiveRole}
                  </span>
                  {viewAsRole && (
                    <span className="text-[8px] px-1 py-0.5 rounded bg-amber-500/20 text-amber-400 border border-amber-400/30">
                      Simul
                    </span>
                  )}
                </button>

                {menuOpen && (
                  <div className="absolute right-0 top-full mt-1 w-52 rounded-xl border border-white/[0.08] bg-[#0d0e14] shadow-2xl shadow-black/50 py-1 animate-fade-up">
                    <div className="px-3 py-2 border-b border-white/[0.06]">
                      <div className="text-xs font-bold text-white">{profile.username}</div>
                      <div className="text-[10px] text-white/30 capitalize">{profile.role}</div>
                    </div>

                    <Link
                      to="/settings/account"
                      onClick={() => setMenuOpen(false)}
                      className="flex items-center gap-2 px-3 py-2 text-xs text-white/50 hover:text-white hover:bg-white/5 transition-all"
                    >
                      <User className="w-3.5 h-3.5" />
                      Mon compte
                    </Link>

                    {(effectiveRole === 'owner' || effectiveRole === 'admin') && (
                      <>
                        <Link
                          to="/settings/agents"
                          onClick={() => setMenuOpen(false)}
                          className="flex items-center gap-2 px-3 py-2 text-xs text-white/50 hover:text-white hover:bg-white/5 transition-all"
                        >
                          <Settings className="w-3.5 h-3.5" />
                          Mes IA
                        </Link>
                        <Link
                          to="/seasons"
                          onClick={() => setMenuOpen(false)}
                          className="flex items-center gap-2 px-3 py-2 text-xs text-white/50 hover:text-white hover:bg-white/5 transition-all"
                        >
                          <Calendar className="w-3.5 h-3.5" />
                          Saisons & Draft
                        </Link>
                        {effectiveRole === 'admin' && (
                          <Link
                            to={`/show/${sid}/host-settings`}
                            onClick={() => setMenuOpen(false)}
                            className="flex items-center gap-2 px-3 py-2 text-xs text-white/50 hover:text-white hover:bg-white/5 transition-all"
                          >
                            <Mic className="w-3.5 h-3.5" />
                            Presentateur IA
                          </Link>
                        )}
                      </>
                    )}

                    {effectiveRole === 'spectator' && (
                      <Link
                        to="/seasons"
                        onClick={() => setMenuOpen(false)}
                        className="flex items-center gap-2 px-3 py-2 text-xs text-white/50 hover:text-white hover:bg-white/5 transition-all"
                      >
                        <Calendar className="w-3.5 h-3.5" />
                        Saisons
                      </Link>
                    )}

                    <button
                      onClick={() => { signOut(); setMenuOpen(false); }}
                      className="flex items-center gap-2 px-3 py-2 text-xs text-red-400/70 hover:text-red-400 hover:bg-red-400/5 transition-all w-full text-left"
                    >
                      <LogOut className="w-3.5 h-3.5" />
                      Deconnexion
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <Link
                to="/auth/login"
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold text-teal-400 bg-teal-500/10 border border-teal-400/20 hover:bg-teal-500/20 transition-all"
              >
                Connexion
              </Link>
            )}
          </nav>

          <button
            onClick={() => setMobileNav(!mobileNav)}
            className="md:hidden p-2 rounded-lg text-white/50 hover:text-white hover:bg-white/5 transition-all"
          >
            {mobileNav ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
        </div>

        {mobileNav && (
          <div className="md:hidden border-t border-white/[0.06] animate-fade-up">
            <div className="px-4 py-3 space-y-1">
              {navItems.map(({ suffix, label, icon: Icon }) => {
                const to = `/show/${sid}/${suffix}`;
                const active = location.pathname.includes(`/${suffix}`);
                return (
                  <Link
                    key={suffix}
                    to={to}
                    className={`
                      flex items-center gap-2 px-3 py-2.5 rounded-lg text-sm font-medium transition-all
                      ${active ? 'bg-white/10 text-white' : 'text-white/50 hover:text-white hover:bg-white/5'}
                    `}
                  >
                    <Icon className="w-4 h-4" />
                    {label}
                  </Link>
                );
              })}
              <div className="h-px bg-white/[0.06] my-2" />
              {profile ? (
                <>
                  <div className="px-3 py-2 text-xs text-white/40">
                    {profile.username} <span className="text-teal-400/60 uppercase font-bold ml-1">{effectiveRole}</span>
                    {viewAsRole && <span className="text-[8px] ml-1 px-1 py-0.5 rounded bg-amber-500/20 text-amber-400">Simul</span>}
                  </div>
                  <Link to="/settings/account" className="flex items-center gap-2 px-3 py-2 text-sm text-white/50 hover:text-white transition-all">
                    <User className="w-4 h-4" /> Mon compte
                  </Link>
                  {(effectiveRole === 'owner' || effectiveRole === 'admin') && (
                    <>
                      <Link to="/settings/agents" className="flex items-center gap-2 px-3 py-2 text-sm text-white/50 hover:text-white transition-all">
                        <Settings className="w-4 h-4" /> Mes IA
                      </Link>
                      <Link to="/seasons" className="flex items-center gap-2 px-3 py-2 text-sm text-white/50 hover:text-white transition-all">
                        <Calendar className="w-4 h-4" /> Saisons & Draft
                      </Link>
                      {effectiveRole === 'admin' && (
                        <Link to={`/show/${sid}/host-settings`} className="flex items-center gap-2 px-3 py-2 text-sm text-white/50 hover:text-white transition-all">
                          <Mic className="w-4 h-4" /> Presentateur IA
                        </Link>
                      )}
                    </>
                  )}
                  <button
                    onClick={() => { signOut(); setMobileNav(false); }}
                    className="flex items-center gap-2 px-3 py-2 text-sm text-red-400/70 hover:text-red-400 w-full text-left transition-all"
                  >
                    <LogOut className="w-4 h-4" /> Deconnexion
                  </button>
                </>
              ) : (
                <Link
                  to="/auth/login"
                  className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold text-teal-400 bg-teal-500/10 border border-teal-400/20 transition-all"
                >
                  Connexion
                </Link>
              )}
            </div>
          </div>
        )}
      </header>

      <main className="flex-1 max-w-7xl mx-auto px-4 sm:px-6 py-6 w-full">
        <Outlet />
      </main>

      <footer className="border-t border-white/[0.06] mt-auto">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-4 flex items-center justify-between flex-wrap gap-4">
          <div className="flex items-center gap-2">
            <div className="w-5 h-5 rounded-md bg-gradient-to-br from-red-500 to-orange-500 flex items-center justify-center">
              <Eye className="w-3 h-3 text-white" />
            </div>
            <span className="text-[10px] font-semibold text-white/25">Secret House</span>
          </div>
          <div className="flex items-center gap-4 text-[10px] text-white/20">
            <Link to="/seasons" className="hover:text-white/40 transition-colors">Saisons & Draft</Link>
            {(effectiveRole === 'owner' || effectiveRole === 'admin') && (
              <Link to="/settings/agents" className="hover:text-white/40 transition-colors">Mes IA</Link>
            )}
            <Link to="/settings/account" className="hover:text-white/40 transition-colors">Mon compte</Link>
          </div>
        </div>
      </footer>

      <ViewAsSelector />
    </div>
  );
}
