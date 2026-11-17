import type { ReactNode } from 'react';
import { Footer, TopNav } from './components/Chrome.tsx';

export function Layout({ children, mock = false }: { children: ReactNode; mock?: boolean }) {
  return (
    <div className="app">
      <a href="#main" className="skip">
        Skip to content
      </a>
      <TopNav mock={mock} />
      <main id="main" className="main">
        {children}
      </main>
      <Footer />
    </div>
  );
}
