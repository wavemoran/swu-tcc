import { useEffect, useState } from 'react';
import { Moon, Sun } from 'lucide-react';
import { Link } from '../router.tsx';
import { safeGet, safeSet } from '../storage.ts';

function systemPrefersLight(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-color-scheme: light)').matches;
}

function effectiveTheme(): 'light' | 'dark' {
  const attr = document.documentElement.getAttribute('data-theme');
  if (attr === 'light' || attr === 'dark') return attr;
  return systemPrefersLight() ? 'light' : 'dark';
}

export function ThemeToggle() {
  const [theme, setTheme] = useState<'light' | 'dark'>(() => effectiveTheme());
  useEffect(() => {
    const saved = safeGet('swu-tcc:theme');
    if (saved === 'light' || saved === 'dark') document.documentElement.setAttribute('data-theme', saved);
    setTheme(effectiveTheme());
  }, []);
  const next = theme === 'dark' ? 'light' : 'dark';
  return (
    <button
      type="button"
      className="btn ghost icon"
      aria-label={`Switch to ${next} theme`}
      onClick={() => {
        document.documentElement.setAttribute('data-theme', next);
        safeSet('swu-tcc:theme', next);
        setTheme(next);
      }}
    >
      {theme === 'dark' ? <Sun size={18} aria-hidden="true" /> : <Moon size={18} aria-hidden="true" />}
    </button>
  );
}

export function TopNav({ mock }: { mock: boolean }) {
  return (
    <nav className="topnav" aria-label="Primary">
      <Link to="/" className="brand" aria-label="SWU TCC home">
        <img src="/brand/mark.svg" alt="" width={32} height={32} />
        <span className="wordmark">
          SWU <span>TCC</span>
        </span>
      </Link>
      <div className="nav-right">
        {mock && <span className="tag mock">MOCK DATA</span>}
        <Link to="/manual" className="navlink">
          Manual
        </Link>
        <ThemeToggle />
      </div>
    </nav>
  );
}

export function Footer() {
  return (
    <footer className="footer">
      <p>
        SWU TCC is an unofficial fan-made tool. Not affiliated with or endorsed by Fantasy Flight Games, Lucasfilm or Disney. Star Wars:
        Unlimited © &amp; ™ Lucasfilm Ltd.
      </p>
      <p>
        <Link to="/privacy">Privacy</Link>
      </p>
    </footer>
  );
}
