import { useAuth } from '../auth/AuthContext';

export default function PrototypeShortcut() {
  const { session } = useAuth();
  if (!session) return null;
  return <a href="/prototipo" style={{ position: 'fixed', right: 18, bottom: 18, zIndex: 9999, padding: '12px 16px', borderRadius: 999, color: 'white', background: '#ff5a00', boxShadow: '0 8px 22px #092f7550', fontWeight: 800, textDecoration: 'none' }}>Flujo integrado</a>;
}
