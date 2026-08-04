import React, { createContext, useContext, useState, useEffect } from 'react';
import { useLocation } from 'react-router-dom';

interface User {
    _id: string;
    email: string;
}

interface AuthContextType {
    user: User | null;
    loading: boolean;
    login: (email: string, password: string) => Promise<{ brokerStatus: string }>;
    register: (email: string, password: string) => Promise<void>;
    logout: () => Promise<void>;
    clearSession: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const API_BASE = 'http://localhost:5000/api/v1/users';

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [user, setUser] = useState<User | null>(null);
    const [loading, setLoading] = useState(true);
    const location = useLocation();

    useEffect(() => {
        // On the login page we never auto-fetch the session.
        // The page will call clearSession() on mount to wipe any stale state.
        // This prevents a logged-in user's cookie from bleeding into a new registration flow.
        if (location.pathname === '/login') {
            setUser(null);
            setLoading(false);
            return;
        }

        const fetchMe = async () => {
            try {
                const res = await fetch(`${API_BASE}/me`, {
                    headers: { 'Content-Type': 'application/json' },
                    credentials: 'include'
                });
                if (res.ok) {
                    const data = await res.json();
                    setUser(data.data.user);
                }
            } catch (err) {
                console.error('Failed to fetch user:', err);
            } finally {
                setLoading(false);
            }
        };
        fetchMe();
    }, [location.pathname]);

    const login = async (email: string, password: string) => {
        const res = await fetch(`${API_BASE}/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password }),
            credentials: 'include'
        });

        if (!res.ok) {
            const data = await res.json();
            throw new Error(data.message || 'Login failed');
        }

        const data = await res.json();
        // Issue #8 FIX: Do NOT store the token in localStorage.
        // The server no longer includes it in the response body.
        // Authentication state is managed entirely via the HttpOnly cookie.
        setUser(data.data.user);
        return { brokerStatus: data.data.brokerStatus || 'NOT_CONFIGURED' };
    };

    const register = async (email: string, password: string) => {
        const res = await fetch(`${API_BASE}/register`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password }),
            credentials: 'include'
        });

        if (!res.ok) {
            const data = await res.json();
            throw new Error(data.message || 'Registration failed');
        }

        const data = await res.json();
        setUser(data.data.user);
    };

    // Wipes React auth state immediately (does NOT touch server cookie).
    // Called by LoginPage on mount so any previous user's context is gone
    // before the register/login form is interacted with.
    const clearSession = () => {
        setUser(null);
    };

    const logout = async () => {
        await fetch(`${API_BASE}/logout`, {
            method: 'POST',
            credentials: 'include'
        });
        // Issue #8 FIX: No localStorage token to remove.
        setUser(null);
    };

    return (
        <AuthContext.Provider value={{ user, loading, login, register, logout, clearSession }}>
            {children}
        </AuthContext.Provider>
    );
};

export const useAuth = () => {
    const context = useContext(AuthContext);
    if (!context) {
        throw new Error('useAuth must be used within an AuthProvider');
    }
    return context;
};
