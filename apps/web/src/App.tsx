import { Layout } from './Layout.tsx';
import { FORCE_MOCK } from './data/load.ts';
import { Landing, Manual } from './pages/Landing.tsx';
import { Privacy } from './pages/Privacy.tsx';
import { TournamentRoute } from './pages/TournamentRoute.tsx';
import { Link, matchRoute, usePath } from './router.tsx';

export function App() {
  const route = matchRoute(usePath());
  switch (route.name) {
    case 'tournament':
      return <TournamentRoute key={route.id} id={route.id} />;
    case 'player':
      // Same component instance as the standings page for this tournament: no refetch when drilling in.
      return <TournamentRoute key={route.id} id={route.id} playerId={route.playerId} />;
    case 'manual':
      return (
        <Layout mock={FORCE_MOCK}>
          <Manual />
        </Layout>
      );
    case 'privacy':
      return (
        <Layout mock={FORCE_MOCK}>
          <Privacy />
        </Layout>
      );
    case 'landing':
      return (
        <Layout mock={FORCE_MOCK}>
          <Landing />
        </Layout>
      );
    default:
      return (
        <Layout mock={FORCE_MOCK}>
          <div className="state">
            <h1 className="page-title">Page not found</h1>
            <Link to="/" className="btn primary">
              Back to start
            </Link>
          </div>
        </Layout>
      );
  }
}
