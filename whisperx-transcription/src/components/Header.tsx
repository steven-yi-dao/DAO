import type { NavTab } from '../types';
import './Header.css';

interface HeaderProps {
  isConnected: boolean;
  nav: NavTab;
  onToggleHistory: () => void;
}

export function Header({ isConnected, nav, onToggleHistory }: HeaderProps) {
  return (
    <header className="app-header">
      <div className="app-header__title">
        Digital Accessibility Office
        {isConnected && <span className="app-header__subtitle"> · Transcribe</span>}
      </div>
      <div className="app-header__account">
        {isConnected && (
          <nav className="app-header__nav" aria-label="Views">
            <button type="button" className="app-header__nav-btn" onClick={onToggleHistory}>
              {nav === 'history' ? 'New transcript' : 'History'}
            </button>
          </nav>
        )}
      </div>
    </header>
  );
}
