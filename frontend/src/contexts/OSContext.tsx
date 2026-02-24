import { getTauriAPI } from '@/lib/tauri-api';
import { createContext, useContext, useState, useEffect, ReactNode } from 'react';

export type OSType = 'windows' | 'macos' | 'linux';

interface OSContextValue {
  os: OSType;
  isWindows: boolean;
  isMacOS: boolean;
  isLinux: boolean;
}

const OSContext = createContext<OSContextValue | undefined>(undefined);

export function OSProvider({ children }: { children: ReactNode }) {
  const [os, setOS] = useState<OSType | null>(null);

  useEffect(() => {
    const tauriAPI = getTauriAPI();
    tauriAPI.invoke<OSType>('get_os').then(setOS);
  }, []);

  if (os === null) {
    return null; // Don't render anything until OS is determined
  }

  const value: OSContextValue = {
    os,
    isWindows: os === 'windows',
    isMacOS: os === 'macos',
    isLinux: os === 'linux'
    // os,
    // isWindows: os === 'windows',
    // isMacOS: true,
    // isLinux: os === 'linux',
  };

  return <OSContext.Provider value={value}>{children}</OSContext.Provider>;
}

export function useOS() {
  const context = useContext(OSContext);
  if (!context) {
    throw new Error('useOS must be used within OSProvider');
  }
  return context;
}