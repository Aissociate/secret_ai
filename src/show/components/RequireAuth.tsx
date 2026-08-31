import { Link, Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import type { Role } from '../api/types';

type RequireAuthProps = {
  /** Roles autorises. Omis: toute session authentifiee convient. */
  roles?: Role[];
};

/**
 * Garde de route.
 *
 * Le routeur n'en avait aucune: les pages de reglages (dont celle exposant la
 * configuration video) etaient accessibles a n'importe quelle URL devinee.
 * C'est une barriere d'interface, pas de securite — la RLS reste l'autorite.
 */
export function RequireAuth({ roles }: RequireAuthProps) {
  const { profile, session, loading, effectiveRole, viewAsRole } = useAuth();
  const location = useLocation();

  /*
    `loading` ne repasse a false que sur le chemin initial. Apres un SIGNED_IN,
    la session existe avant que le profil ne soit charge: se fier au profil
    seul renvoyait l'utilisateur vers /auth/login juste apres sa connexion.
  */
  if (loading || (session && !profile)) {
    return (
      <div className="flex items-center justify-center py-24">
        <div className="w-6 h-6 rounded-full border-2 border-white/20 border-t-teal-400 animate-spin" />
        <span className="sr-only">Chargement de la session</span>
      </div>
    );
  }

  if (!session) {
    return <Navigate to="/auth/login" replace state={{ from: location.pathname }} />;
  }

  /*
    La garde suit le role EFFECTIF, pas le role reel: un admin qui previsualise
    en spectateur doit se voir refuser les menus de configuration, sinon
    l'apercu ne montre pas ce que verrait un spectateur.

    Le selecteur reste monte dans le layout, donc on peut toujours revenir a son
    role reel depuis cette page.
  */
  if (roles && profile && !roles.includes(effectiveRole)) {
    return (
      <div className="max-w-lg mx-auto py-20 px-6 text-center">
        <h1 className="text-lg font-bold text-white mb-2">Acces reserve</h1>
        <p className="text-sm text-white/50 mb-6">
          Cette page est reservee aux roles&nbsp;: {roles.join(', ')}. Votre role
          actuel est «&nbsp;{effectiveRole}&nbsp;».
          {viewAsRole && (
            <>
              {' '}Vous previsualisez en tant que «&nbsp;{viewAsRole}&nbsp;» ;
              revenez a votre role reel pour acceder a cette page.
            </>
          )}
        </p>
        <Link
          to="/seasons"
          className="inline-block px-4 py-2 text-sm font-medium text-white bg-white/[0.06] border border-white/10 rounded-lg hover:bg-white/[0.1] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-400"
        >
          Retour aux saisons
        </Link>
      </div>
    );
  }

  return <Outlet />;
}
