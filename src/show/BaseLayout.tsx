import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useState, useRef, useEffect } from 'react';
import { Eye, Calendar, Settings, User, LogOut, Menu, X, ChevronLeft, Bot } from 'lucide-react';
import { useAuth } from './context/AuthContext';
import { WalletPanel } from './components/WalletPanel';
import { ViewAsSelector } from './components/ViewAsSelector';

const navItems = [
  { to: '/seasons', label: 'Saisons', icon: Calendar },
  { to: '/settings/agents', label: 'Mes IA', icon: Bot },
  { to: '/settings/account', label: 'Mon compte', icon: Settings },
];

export function BaseLayout() {
  const location = useLocation();
  const navigate = useNavigate();
  const { profile, signOut, effectiveRole, configError } = useAuth();
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

  const canGoBack = window.history.length > 1;

  const visibleNavItems = navItems.filter(({ to }) => {
    if (to === '/settings/agents' && effectiveRole !== 'owner' && effectiveRole !== 'admin') return false;
    if (to === '/settings/account' && !profile) return false;
    return true;
  });

  return (
    <div className="min-h-screen bg-[#08090d] text-white flex flex-col">
      <header className="sticky top-0 z-30 border-b border-white/[0.06] glass">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            {canGoBack && (
              <button
                onClick={() => navigate(-1)}
                className="flex items-center justify-center w-8 h-8 rounded-lg text-white/30 hover:text-white hover:bg-white/5 transition-all"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
            )}

            <Link to="/seasons" className="flex items-center gap-2.5 group">
              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-red-500 to-orange-500 flex items-center justify-center shadow-lg shadow-red-500/20">
                <Eye className="w-4 h-4 text-white" />
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-[0.15em] text-white/40 font-semibold leading-none">
                  Secret House
                </div>
                <div className="text-sm font-bold text-white leading-tight">
                  Saisons & Draft
                </div>
              </div>
            </Link>
          </div>

          <nav className="hidden md:flex items-center gap-1">
            {visibleNavItems.map(({ to, label, icon: Icon }) => {
              const active = location.pathname.startsWith(to);
              return (
                <Link
                  key={to}
                  to={to}
                  className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium transition-all duration-200 ${
                    active
                      ? 'bg-white/10 text-white'
                      : 'text-white/40 hover:text-white/70 hover:bg-white/5'
                  }`}
                >
                  <Icon className="w-3.5 h-3.5" />
                  {label}
                </Link>
              );
            })}

            <div className="w-px h-6 bg-white/[0.06] mx-2" />

            {/*
              Le solde conditionne desormais la participation: il doit se voir
              sans avoir a ouvrir une page de reglages.
            */}
            {profile && (
              <Link
                to="/settings/account"
                className="mr-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-400 rounded-lg"
                title="Mon solde"
              >
                <WalletPanel compact />
              </Link>
            )}

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
                </button>

                {menuOpen && (
                  <div className="absolute right-0 top-full mt-1 w-48 rounded-xl border border-white/[0.08] bg-[#0d0e14] shadow-2xl shadow-black/50 py-1 animate-fade-up">
                    <div className="px-3 py-2 border-b border-white/[0.06]">
                      <div className="text-xs font-bold text-white">{profile.username}</div>
                      <div className="text-[10px] text-white/30 capitalize">{profile.role}</div>
                    </div>
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
              {visibleNavItems.map(({ to, label, icon: Icon }) => {
                const active = location.pathname.startsWith(to);
                return (
                  <Link
                    key={to}
                    to={to}
                    className={`flex items-center gap-2 px-3 py-2.5 rounded-lg text-sm font-medium transition-all ${
                      active ? 'bg-white/10 text-white' : 'text-white/50 hover:text-white hover:bg-white/5'
                    }`}
                  >
                    <Icon className="w-4 h-4" />
                    {label}
                  </Link>
                );
              })}
              <div className="h-px bg-white/[0.06] my-2" />
              {profile ? (
                <>
                  <div className="px-3 py-2 text-xs text-white/40">{profile.username}</div>
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

      <main className="flex-1 max-w-5xl w-full mx-auto px-4 sm:px-6 py-8">
        {configError && (
          <div className="mb-6 p-4 rounded-xl border border-amber-400/30 bg-amber-500/10 text-sm text-amber-200">
            <strong className="font-bold">Connexion a la base impossible.</strong>{' '}
            {configError}
          </div>
        )}
        <Outlet />
      </main>

      <footer className="border-t border-white/[0.06] mt-auto">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 flex items-center justify-between flex-wrap gap-4">
          <div className="flex items-center gap-2.5">
            <div className="w-6 h-6 rounded-md bg-gradient-to-br from-red-500 to-orange-500 flex items-center justify-center">
              <Eye className="w-3.5 h-3.5 text-white" />
            </div>
            <span className="text-xs font-semibold text-white/30">Secret House</span>
          </div>
          <div className="flex items-center gap-4 text-[10px] text-white/20">
            <Link to="/seasons" className="hover:text-white/40 transition-colors">Saisons</Link>
            {profile && (
              <>
                <Link to="/settings/account" className="hover:text-white/40 transition-colors">Mon compte</Link>
                {(effectiveRole === 'owner' || effectiveRole === 'admin') && (
                  <Link to="/settings/agents" className="hover:text-white/40 transition-colors">Mes IA</Link>
                )}
              </>
            )}
          </div>
        </div>
      </footer>
    
      <ViewAsSelector />
    </div>
  );
}
