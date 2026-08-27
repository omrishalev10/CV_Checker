import { NavLink, Route, Routes } from "react-router-dom";
import HomePage from "./pages/HomePage";
import ProfilePage from "./pages/ProfilePage";
import MatchPage from "./pages/MatchPage";
import HistoryPage from "./pages/HistoryPage";
import MatchDetailPage from "./pages/MatchDetailPage";
import SettingsPage from "./pages/SettingsPage";
import AccountMenu from "./components/AccountMenu";
import AuthGate from "./components/AuthGate";
import { AppInstallProvider } from "./components/AppModeToggle";
import BottomNav from "./components/BottomNav";
import BrandMark from "./components/BrandMark";

export default function App() {
  return (
    <AuthGate>
      <AppInstallProvider>
        <AppShell />
      </AppInstallProvider>
    </AuthGate>
  );
}

function AppShell() {
  return (
    <div className="app-shell">
      <header className="topbar">
        <NavLink to="/" className="brand">
          <BrandMark />
          Career<span>Fit</span>
        </NavLink>
        <nav className="nav nav-primary" aria-label="Primary">
          <NavLink to="/profile" className={({ isActive }) => (isActive ? "active" : "")}>
            Profile
          </NavLink>
          <NavLink to="/match" className={({ isActive }) => (isActive ? "active" : "")}>
            Check job
          </NavLink>
          <NavLink to="/history" className={({ isActive }) => (isActive ? "active" : "")}>
            My jobs
          </NavLink>
          <NavLink to="/settings" className={({ isActive }) => (isActive ? "active" : "")}>
            Settings
          </NavLink>
        </nav>
        <div className="topbar-end">
          <AccountMenu />
        </div>
      </header>
      <main className="app-main">
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/profile" element={<ProfilePage />} />
          <Route path="/match" element={<MatchPage />} />
          <Route path="/history" element={<HistoryPage />} />
          <Route path="/history/:id" element={<MatchDetailPage />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Routes>
      </main>
      <BottomNav />
    </div>
  );
}
