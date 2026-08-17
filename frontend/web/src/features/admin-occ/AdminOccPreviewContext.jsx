import { createContext, useContext, useState } from 'react';

const AdminOccPreviewContext = createContext({ forceState: 'default', setForceState: () => {} });

export function AdminOccPreviewProvider({ children }) {
  const [forceState, setForceState] = useState('default');
  return (
    <AdminOccPreviewContext.Provider value={{ forceState, setForceState }}>
      {children}
    </AdminOccPreviewContext.Provider>
  );
}

export function useAdminOccPreview() {
  return useContext(AdminOccPreviewContext);
}
