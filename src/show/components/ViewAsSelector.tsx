import { Eye, Crown, Users, Shield } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import type { Role } from '../api/types';

const ROLE_CONFIGS = {
  spectator: {
    label: 'Visiteur',
    icon: Eye,
    color: 'text-gray-400',
    bgColor: 'bg-gray-500/20',
    borderColor: 'border-gray-400/30',
    description: 'Vue publique limitée',
  },
  owner: {
    label: 'Owner',
    icon: Crown,
    color: 'text-amber-400',
    bgColor: 'bg-amber-500/20',
    borderColor: 'border-amber-400/30',
    description: 'Propriétaire d\'agent',
  },
  admin: {
    label: 'Admin',
    icon: Shield,
    color: 'text-teal-400',
    bgColor: 'bg-teal-500/20',
    borderColor: 'border-teal-400/30',
    description: 'Accès complet',
  },
};

export function ViewAsSelector() {
  const { isAdmin, viewAsRole, effectiveRole, setViewAsRole, profile } = useAuth();

  if (!isAdmin) return null;

  const roles: Role[] = ['spectator', 'owner', 'admin'];

  return (
    <div className="fixed bottom-6 right-6 z-50">
      <div className="bg-[#0d0e14] border border-white/10 rounded-2xl p-4 shadow-2xl backdrop-blur-xl">
        <div className="flex items-center gap-2 mb-3">
          <Shield className="w-4 h-4 text-teal-400" />
          <h3 className="text-xs font-bold text-white/80 uppercase tracking-wider">
            Mode Admin
          </h3>
        </div>

        <p className="text-[10px] text-white/40 mb-3">
          Voir l'interface en tant que:
        </p>

        <div className="space-y-2">
          {roles.map((role) => {
            const config = ROLE_CONFIGS[role];
            const Icon = config.icon;
            const isActive = effectiveRole === role;
            const isActualRole = profile?.role === role && !viewAsRole;

            return (
              <button
                key={role}
                onClick={() => {
                  if (role === profile?.role) {
                    setViewAsRole(null);
                  } else {
                    setViewAsRole(role);
                  }
                }}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl border transition-all ${
                  isActive
                    ? `${config.bgColor} ${config.borderColor} ${config.color}`
                    : 'bg-white/[0.02] border-white/6 text-white/50 hover:bg-white/[0.04] hover:border-white/10'
                }`}
              >
                <div
                  className={`w-8 h-8 rounded-lg flex items-center justify-center ${
                    isActive ? config.bgColor : 'bg-white/5'
                  }`}
                >
                  <Icon className="w-4 h-4" />
                </div>
                <div className="flex-1 text-left">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold">{config.label}</span>
                    {isActualRole && (
                      <span className="text-[9px] px-1.5 py-0.5 rounded bg-teal-500/20 text-teal-400 border border-teal-400/30">
                        Réel
                      </span>
                    )}
                  </div>
                  <p className="text-[10px] opacity-60">{config.description}</p>
                </div>
                {isActive && (
                  <div className="w-2 h-2 rounded-full bg-current animate-pulse" />
                )}
              </button>
            );
          })}
        </div>

        <div className="mt-3 pt-3 border-t border-white/6">
          <div className="flex items-center gap-2 text-[10px] text-white/30">
            <Users className="w-3 h-3" />
            <span>
              {viewAsRole
                ? `Simulant le rôle: ${ROLE_CONFIGS[viewAsRole].label}`
                : `Rôle actuel: ${ROLE_CONFIGS[effectiveRole].label}`}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
