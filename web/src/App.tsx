import { NavLink, Route, Routes } from "react-router-dom";
import HomePage from "./pages/HomePage";
import ProfilePage from "./pages/ProfilePage";
import MatchPage from "./pages/MatchPage";
import HistoryPage from "./pages/HistoryPage";
import MatchDetailPage from "./pages/MatchDetailPage";
import SettingsPage from "./pages/SettingsPage";
import AppModeToggle from "./components/AppModeToggle";
import AuthGate, { useAuth } from "./components/AuthGate";
import ThemeToggle from "./components/ThemeToggle";

export default function App() {
  return (
    <AuthGate>
      <AppShell />
    </AuthGate>
  );
}

function AppShell() {
  const { username, signOut } = useAuth();

  return (
    <div className="app-shell">
      <header className="topbar">
        <NavLink to="/" className="brand">
          Career<span>Fit</span>
        </NavLink>
        <nav className="nav">
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
          <span className="nav-user" title={username || ""}>
            {username}
          </span>
          <button type="button" className="btn btn-ghost" onClick={() => signOut()}>
            Sign out
          </button>
          <ThemeToggle />
          <AppModeToggle />
        </nav>
      </header>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/profile" element={<ProfilePage />} />
        <Route path="/match" element={<MatchPage />} />
        <Route path="/history" element={<HistoryPage />} />
        <Route path="/history/:id" element={<MatchDetailPage />} />
        <Route path="/settings" element={<SettingsPage />} />
      </Routes>
    </div>
  );
}
