import { createContext, useContext, useEffect, useState } from "react";
import { api } from "../services/api.js";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const token = localStorage.getItem("raasta_token");
    const cachedUser = localStorage.getItem("raasta_user");
    if (token && cachedUser) {
      setUser(JSON.parse(cachedUser));
    }
    setReady(true);
  }, []);

  function persist(token, user) {
    localStorage.setItem("raasta_token", token);
    localStorage.setItem("raasta_user", JSON.stringify(user));
    setUser(user);
  }

  async function login(email, password) {
    const data = await api.login({ email, password });
    persist(data.token, data.user);
  }

  async function signup(name, email, password) {
    const data = await api.signup({ name, email, password });
    persist(data.token, data.user);
  }

  function logout() {
    localStorage.removeItem("raasta_token");
    localStorage.removeItem("raasta_user");
    setUser(null);
  }

  return (
    <AuthContext.Provider value={{ user, ready, login, signup, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
