import React, { useState, useRef, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useNavigate } from 'react-router-dom';
import { apiPost } from '../../trading/api';
import { 
  LogIn, 
  Mail, 
  Lock, 
  ShieldCheck, 
  UserPlus, 
  Key, 
  ArrowRight,
  ShieldAlert,
  Server,
  Globe
} from 'lucide-react';

type ViewState = 'login' | 'register' | 'broker_verification' | 'broker_setup';

const LoginPage: React.FC = () => {
  const [view, setView] = useState<ViewState>('login');
  
  // App Credentials
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  
  // Broker Credentials (Setup only)
  const [clientCode, setClientCode] = useState('');
  const [apiKey, setApiKey] = useState('');
  
  // Ephemeral Verification Inputs (MPIN & TOTP)
  const [totp, setTotp] = useState('');
  const [digits, setDigits] = useState<string[]>(['', '', '', '']);
  const inputs = [
    useRef<HTMLInputElement | null>(null),
    useRef<HTMLInputElement | null>(null),
    useRef<HTMLInputElement | null>(null),
    useRef<HTMLInputElement | null>(null),
  ];

  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  
  const { login, register, clearSession } = useAuth();
  const navigate = useNavigate();

  // On mount: instantly clear React user state so no stale user bleeds
  // into this login/register form.
  // NOTE: We do NOT call logout() here because it would race with the
  // register() call — if logout() resolved after register(), it would
  // clear the new user's cookie and break broker setup.
  useEffect(() => {
    clearSession();
  }, []);

  // Reset ephemeral inputs when view changes
  useEffect(() => {
    setError(null);
    setTotp('');
    setDigits(['', '', '', '']);
    setPassword('');
    setConfirmPassword('');
  }, [view]);

  // Focus first MPIN input when entering verification or setup
  useEffect(() => {
    if (view === 'broker_verification' || view === 'broker_setup') {
      setTimeout(() => inputs[0].current?.focus(), 100);
    }
  }, [view]);

  const handleMpinChange = (v: string, idx: number) => {
    const numericVal = v.replace(/\D/g, '').slice(0, 1);
    setDigits((prev) => {
      const next = [...prev];
      next[idx] = numericVal;
      return next;
    });
    if (numericVal && idx < inputs.length - 1) {
      inputs[idx + 1].current?.focus();
    }
  };

  const handleMpinKeyDown = (e: React.KeyboardEvent<HTMLInputElement>, idx: number) => {
    if (e.key === 'Backspace' && !digits[idx] && idx > 0) {
      inputs[idx - 1].current?.focus();
    }
  };

  // 1. Submit Email & Password (Login)
  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const { brokerStatus } = await login(email, password);
      // If broker settings are not configured yet, direct to broker setup page.
      // Otherwise, redirect to verify screen to enter MPIN and TOTP to authenticate the live session.
      if (brokerStatus === 'NOT_CONFIGURED') {
        setView('broker_setup');
      } else {
        setView('broker_verification');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  // 2. Submit Email & Password (Registration)
  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    setLoading(true);

    try {
      await register(email, password);
      // New users start without a broker profile, redirect to broker configuration setup
      setView('broker_setup');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Registration failed');
    } finally {
      setLoading(false);
    }
  };

  // 3. Submit MPIN & TOTP (Verify existing Broker connection)
  const handleBrokerVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const mpin = digits.join('');
    if (mpin.length !== 4 || totp.length !== 6) {
      setError('Please fill in complete MPIN and TOTP values.');
      setLoading(false);
      return;
    }

    try {
      await apiPost('/broker/angel/reauthenticate', { mpin, totp });
      navigate('/dashboard');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Verification failed');
    } finally {
      setLoading(false);
    }
  };

  // 4. Submit Full Broker Configuration (New connection setup)
  const handleBrokerSetup = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const mpin = digits.join('');
    if (!clientCode || !apiKey || mpin.length !== 4 || totp.length !== 6) {
      setError('Please fill in all broker setup fields.');
      setLoading(false);
      return;
    }

    try {
      await apiPost('/broker/angel/connect', {
        clientCode: clientCode.trim().toUpperCase(),
        apiKey: apiKey.trim(),
        mpin,
        totp
      });
      navigate('/dashboard');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Setup failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#F8F9FA] flex items-center justify-center p-4 select-none">
      <div className="max-w-md w-full">
        {/* Branding Title */}
        <div className="text-center mb-6">
          <div className="inline-flex items-center justify-center p-2.5 bg-[#0052FF] rounded-md shadow-sm mb-3">
            <ShieldCheck className="w-6 h-6 text-white" />
          </div>
          <h1 className="text-lg font-bold text-[#1E222D] tracking-tight">Institutional Trading Portal</h1>
          <p className="text-xs font-semibold text-[#787B86] mt-0.5">Angel One Automated Options Engine</p>
        </div>

        {/* Dynamic Card Container */}
        <div className="bg-white rounded border border-[#E0E3EB] shadow-sm p-6">
          {error && (
            <div className="mb-4 p-3 bg-[#F23645]/10 border border-[#F23645]/30 rounded flex items-start gap-2.5">
              <ShieldAlert className="w-4 h-4 text-[#F23645] shrink-0 mt-0.5" />
              <p className="text-xs text-[#F23645] font-semibold">{error}</p>
            </div>
          )}

          {/* VIEW: LOGIN */}
          {view === 'login' && (
            <form onSubmit={handleLogin} className="space-y-4">
              <div className="space-y-1">
                <label className="block text-[10px] font-bold uppercase text-[#787B86]">Email Address</label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#787B86]" />
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="user@angelone.com"
                    className="w-full pl-9 pr-3 py-2 bg-[#F0F3FA] border border-[#E0E3EB] rounded text-xs font-semibold text-[#1E222D] outline-none focus:border-[#0052FF]"
                    required
                    disabled={loading}
                  />
                </div>
              </div>

              <div className="space-y-1">
                <label className="block text-[10px] font-bold uppercase text-[#787B86]">Password</label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#787B86]" />
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    className="w-full pl-9 pr-3 py-2 bg-[#F0F3FA] border border-[#E0E3EB] rounded text-xs font-semibold text-[#1E222D] outline-none focus:border-[#0052FF]"
                    required
                    disabled={loading}
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full py-2.5 bg-[#0052FF] hover:bg-[#0047D6] text-white font-bold text-xs uppercase tracking-wider rounded transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
              >
                {loading ? (
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                ) : (
                  <>
                    <span>Sign In</span>
                    <LogIn className="w-3.5 h-3.5" />
                  </>
                )}
              </button>

              <div className="pt-2 text-center border-t border-[#F0F3FA]">
                <button
                  type="button"
                  onClick={() => setView('register')}
                  className="text-[11px] font-bold text-[#0052FF] hover:underline"
                  disabled={loading}
                >
                  New here? Create New Account
                </button>
              </div>
            </form>
          )}

          {/* VIEW: REGISTER */}
          {view === 'register' && (
            <form onSubmit={handleRegister} className="space-y-4">
              <div className="space-y-1">
                <label className="block text-[10px] font-bold uppercase text-[#787B86]">Email Address</label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#787B86]" />
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="user@angelone.com"
                    className="w-full pl-9 pr-3 py-2 bg-[#F0F3FA] border border-[#E0E3EB] rounded text-xs font-semibold text-[#1E222D] outline-none focus:border-[#0052FF]"
                    required
                    disabled={loading}
                  />
                </div>
              </div>

              <div className="space-y-1">
                <label className="block text-[10px] font-bold uppercase text-[#787B86]">Password</label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#787B86]" />
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Create Password"
                    className="w-full pl-9 pr-3 py-2 bg-[#F0F3FA] border border-[#E0E3EB] rounded text-xs font-semibold text-[#1E222D] outline-none focus:border-[#0052FF]"
                    required
                    disabled={loading}
                  />
                </div>
              </div>

              <div className="space-y-1">
                <label className="block text-[10px] font-bold uppercase text-[#787B86]">Confirm Password</label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#787B86]" />
                  <input
                    type="password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="Confirm Password"
                    className="w-full pl-9 pr-3 py-2 bg-[#F0F3FA] border border-[#E0E3EB] rounded text-xs font-semibold text-[#1E222D] outline-none focus:border-[#0052FF]"
                    required
                    disabled={loading}
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full py-2.5 bg-[#0052FF] hover:bg-[#0047D6] text-white font-bold text-xs uppercase tracking-wider rounded transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
              >
                {loading ? (
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                ) : (
                  <>
                    <span>Create Account</span>
                    <UserPlus className="w-3.5 h-3.5" />
                  </>
                )}
              </button>

              <div className="pt-2 text-center border-t border-[#F0F3FA]">
                <button
                  type="button"
                  onClick={() => setView('login')}
                  className="text-[11px] font-bold text-[#0052FF] hover:underline"
                  disabled={loading}
                >
                  Already have an account? Sign In
                </button>
              </div>
            </form>
          )}

          {/* VIEW: BROKER VERIFICATION (Existing Users) */}
          {view === 'broker_verification' && (
            <form onSubmit={handleBrokerVerify} className="space-y-5">
              <div className="text-center pb-2 border-b border-[#F0F3FA]">
                <h3 className="text-xs font-bold text-[#1E222D] uppercase tracking-wider flex items-center justify-center gap-1.5">
                  <Server className="w-3.5 h-3.5 text-[#0052FF]" /> Verify Broker Connection
                </h3>
                <p className="text-[10px] text-[#787B86] font-medium mt-1">Enter your MPIN and TOTP to start your live session.</p>
              </div>

              {/* 4-Digit MPIN Code Blocks */}
              <div className="space-y-1.5">
                <label className="block text-[10px] font-bold uppercase text-[#787B86] text-center">4-Digit Broker MPIN</label>
                <div className="flex items-center justify-center gap-2">
                  {digits.map((digit, idx) => (
                    <input
                      key={idx}
                      ref={inputs[idx]}
                      type="text"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      maxLength={1}
                      value={digit}
                      onChange={(e) => handleMpinChange(e.target.value, idx)}
                      onKeyDown={(e) => handleMpinKeyDown(e, idx)}
                      className="w-10 h-10 border border-[#E0E3EB] bg-[#F0F3FA] rounded text-center text-sm font-bold text-[#1E222D] outline-none focus:border-[#0052FF] focus:bg-white"
                      disabled={loading}
                      required
                    />
                  ))}
                </div>
              </div>

              {/* TOTP 6-Digit input */}
              <div className="space-y-1">
                <label className="block text-[10px] font-bold uppercase text-[#787B86]">Google Authenticator TOTP</label>
                <div className="relative">
                  <Key className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#787B86]" />
                  <input
                    type="text"
                    maxLength={6}
                    pattern="[0-9]*"
                    inputMode="numeric"
                    value={totp}
                    onChange={(e) => setTotp(e.target.value.replace(/\D/g, ''))}
                    placeholder="6-Digit Verification Code"
                    className="w-full pl-9 pr-3 py-2 bg-[#F0F3FA] border border-[#E0E3EB] rounded text-xs font-semibold text-[#1E222D] outline-none focus:border-[#0052FF]"
                    required
                    disabled={loading}
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full py-2.5 bg-[#089981] hover:bg-[#07856F] text-white font-bold text-xs uppercase tracking-wider rounded transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
              >
                {loading ? (
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                ) : (
                  <>
                    <span>Verify &amp; Connect</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </>
                )}
              </button>

              <div className="pt-2 text-center border-t border-[#F0F3FA]">
                <button
                  type="button"
                  onClick={() => setView('login')}
                  className="text-[11px] font-bold text-[#787B86] hover:text-[#0052FF] hover:underline"
                  disabled={loading}
                >
                  ← Back to Sign In
                </button>
              </div>
            </form>
          )}

          {/* VIEW: BROKER SETUP (New Users / Unconfigured profiles) */}
          {view === 'broker_setup' && (
            <form onSubmit={handleBrokerSetup} className="space-y-4">
              <div className="text-center pb-2 border-b border-[#F0F3FA]">
                <h3 className="text-xs font-bold text-[#1E222D] uppercase tracking-wider flex items-center justify-center gap-1.5">
                  <Globe className="w-3.5 h-3.5 text-[#0052FF]" /> Configure Trading Gateway
                </h3>
                <p className="text-[10px] text-[#787B86] font-medium mt-1">Connect your Angel One API credentials.</p>
              </div>

              <div className="space-y-1">
                <label className="block text-[10px] font-bold uppercase text-[#787B86]">Client Code</label>
                <input
                  type="text"
                  placeholder="e.g. M12345"
                  value={clientCode}
                  onChange={(e) => setClientCode(e.target.value)}
                  className="w-full px-3 py-2 bg-[#F0F3FA] border border-[#E0E3EB] rounded text-xs font-semibold text-[#1E222D] outline-none focus:border-[#0052FF]"
                  required
                  disabled={loading}
                />
              </div>

              <div className="space-y-1">
                <label className="block text-[10px] font-bold uppercase text-[#787B86]">API Key</label>
                <input
                  type="text"
                  placeholder="Paste your smartAPI developer key"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  className="w-full px-3 py-2 bg-[#F0F3FA] border border-[#E0E3EB] rounded text-xs font-semibold text-[#1E222D] outline-none focus:border-[#0052FF]"
                  required
                  disabled={loading}
                />
              </div>

              {/* 4-Digit MPIN Code Blocks */}
              <div className="space-y-1.5">
                <label className="block text-[10px] font-bold uppercase text-[#787B86] text-center">4-Digit Broker MPIN</label>
                <div className="flex items-center justify-center gap-2">
                  {digits.map((digit, idx) => (
                    <input
                      key={idx}
                      ref={inputs[idx]}
                      type="text"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      maxLength={1}
                      value={digit}
                      onChange={(e) => handleMpinChange(e.target.value, idx)}
                      onKeyDown={(e) => handleMpinKeyDown(e, idx)}
                      className="w-10 h-10 border border-[#E0E3EB] bg-[#F0F3FA] rounded text-center text-sm font-bold text-[#1E222D] outline-none focus:border-[#0052FF] focus:bg-white"
                      disabled={loading}
                      required
                    />
                  ))}
                </div>
              </div>

              {/* TOTP 6-Digit input */}
              <div className="space-y-1">
                <label className="block text-[10px] font-bold uppercase text-[#787B86]">Google Authenticator TOTP</label>
                <div className="relative">
                  <Key className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#787B86]" />
                  <input
                    type="text"
                    maxLength={6}
                    pattern="[0-9]*"
                    inputMode="numeric"
                    value={totp}
                    onChange={(e) => setTotp(e.target.value.replace(/\D/g, ''))}
                    placeholder="6-Digit Verification Code"
                    className="w-full pl-9 pr-3 py-2 bg-[#F0F3FA] border border-[#E0E3EB] rounded text-xs font-semibold text-[#1E222D] outline-none focus:border-[#0052FF]"
                    required
                    disabled={loading}
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full py-2.5 bg-[#0052FF] hover:bg-[#0047D6] text-white font-bold text-xs uppercase tracking-wider rounded transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
              >
                {loading ? (
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                ) : (
                  <>
                    <span>Configure &amp; Connect</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </>
                )}
              </button>

              <div className="pt-2 text-center border-t border-[#F0F3FA]">
                <button
                  type="button"
                  onClick={() => setView('login')}
                  className="text-[11px] font-bold text-[#787B86] hover:text-[#0052FF] hover:underline"
                  disabled={loading}
                >
                  ← Back to Sign In
                </button>
              </div>
            </form>
          )}
        </div>

        <div className="mt-6 text-center">
          <p className="text-[#787B86] text-[10px] font-bold uppercase tracking-wider">Enterprise Algo Terminal v2.4</p>
        </div>
      </div>
    </div>
  );
};

export default LoginPage;
