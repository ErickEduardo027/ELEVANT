import { useCallback, useState } from 'react';

export function usePreviewControls() {
  const [theme, setTheme] = useState('light');
  const [forceState, setForceState] = useState('default');

  const toggleTheme = useCallback(() => {
    setTheme(current => (current === 'light' ? 'dark' : 'light'));
  }, []);

  return { theme, toggleTheme, forceState, setForceState };
}
