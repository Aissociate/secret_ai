import { Component, type ErrorInfo, type ReactNode } from 'react';

type Props = { children: ReactNode };
type State = { error: Error | null };

/**
 * Filet de securite du rendu.
 *
 * Sans lui, une seule exception de rendu (un champ absent sur `season`, par
 * exemple) laissait une page entierement blanche, sans message ni moyen de
 * revenir en arriere.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Erreur de rendu non rattrapee:', error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="min-h-screen flex items-center justify-center bg-[#0a0b10] px-6">
        <div className="max-w-md w-full bg-white/[0.03] border border-white/10 rounded-2xl p-8 text-center">
          <h1 className="text-lg font-bold text-white mb-2">Une erreur est survenue</h1>
          <p className="text-sm text-white/50 mb-6">
            L&apos;affichage de cette page a echoue. Vous pouvez reessayer&nbsp;; si
            le probleme persiste, revenez a la liste des saisons.
          </p>

          <pre className="text-left text-[11px] text-red-300/70 bg-red-500/[0.06] border border-red-500/20 rounded-lg p-3 mb-6 overflow-x-auto">
            {error.message}
          </pre>

          <div className="flex gap-3 justify-center">
            <button
              onClick={() => this.setState({ error: null })}
              className="px-4 py-2 text-sm font-medium text-white bg-teal-500/20 border border-teal-400/30 rounded-lg hover:bg-teal-500/30 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-400"
            >
              Reessayer
            </button>
            <a
              href="/seasons"
              className="px-4 py-2 text-sm font-medium text-white/70 bg-white/[0.04] border border-white/10 rounded-lg hover:bg-white/[0.08] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-400"
            >
              Retour aux saisons
            </a>
          </div>
        </div>
      </div>
    );
  }
}
