import { Routes, Route, Navigate } from "react-router-dom";
import { useAuth } from "./context/AuthContext.jsx";
import Landing from "./pages/Landing.jsx";
import Auth from "./pages/Auth.jsx";
import Dashboard from "./pages/Dashboard.jsx";
import Modes from "./pages/Modes.jsx";
import GovernmentPanel from "./components/GovernmentPanel.jsx";
import EmergencyPanel from "./components/EmergencyPanel.jsx";

function Protected({ children }) {
  const { user, ready } = useAuth();
  if (!ready) return null;
  if (!user) return <Navigate to="/auth" replace />;
  return children;
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/auth" element={<Auth />} />
      <Route
        path="/modes"
        element={
          <Protected>
            <Modes />
          </Protected>
        }
      />
      <Route
        path="/app"
        element={
          <Protected>
            <Dashboard />
          </Protected>
        }
      />
      <Route
        path="/gov"
        element={
          <Protected>
            <GovernmentPanel />
          </Protected>
        }
      />
      <Route
        path="/emergency"
        element={
          <Protected>
            <EmergencyPanel />
          </Protected>
        }
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
