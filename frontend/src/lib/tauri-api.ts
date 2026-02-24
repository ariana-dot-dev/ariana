import { invoke as tauriInvoke } from '@tauri-apps/api/core';
import { EventCallback, EventName, Options, listen as tauriListen, UnlistenFn } from '@tauri-apps/api/event';
import { load as tauriLoad } from '@tauri-apps/plugin-store';


export abstract class Store {
  abstract set(key: string, value: unknown): Promise<void>;
  abstract save(): Promise<void>;
  abstract get<T>(key: string): Promise<T | undefined>;
  abstract delete(key: string): Promise<boolean>;
}

async function load(path: string): Promise<Store> {
  const pathURLEncoded = encodeURIComponent(path);
  const store = new StoreLocalstorage(pathURLEncoded);
  return store;
}

export class StoreLocalstorage extends Store {
  private data: Record<string, unknown> = {};

  constructor(public name: string) {
    super();
  }

  async set(key: string, value: unknown): Promise<void> {
    this.data[key] = value;
    localStorage.setItem(this.name + '::' + key, JSON.stringify(value));
    return Promise.resolve();
  }

  async get<T>(key: string): Promise<T | undefined> {
    const value = localStorage.getItem(this.name + '::' + key);
    if (value) {
      return JSON.parse(value) as T;
    }
    return undefined;
  }

  async save(): Promise<void> {
    for (const [key, value] of Object.entries(this.data)) {
      localStorage.setItem(this.name + '::' + key, JSON.stringify(value));
    }
  }

  async delete(key: string): Promise<boolean> {
    const existed = this.data[key] !== undefined;
    delete this.data[key];
    localStorage.removeItem(this.name + '::' + key);
    return existed;
  }
}

/**
 * Abstract Tauri API interface
 * Provides platform-agnostic access to Tauri commands
 */
export abstract class TauriAPI {
  abstract invoke<T = unknown>(cmd: string, args?: Record<string, unknown>): Promise<T>;
  abstract listen<T>(event: EventName, handler: EventCallback<T>, options?: Options): Promise<UnlistenFn>;
  abstract load(path: string, options: { autoSave: boolean }): Promise<Store>;

  // SSH key management methods
  async listAvailableSshKeys(): Promise<Array<{ name: string; publicKeyPath: string; privateKeyPath: string; keyType: string }>> {
    return this.invoke('list_available_ssh_keys');
  }

  async readSshKeyPair(keyName: string): Promise<[string, string]> {
    return this.invoke('read_ssh_key_pair', { keyName });
  }
}

/**
 * Browser/Web implementation - mocks all Tauri API calls
 */
export class BrowserTauriMockAPI extends TauriAPI {
  async invoke<T = unknown>(cmd: string, args?: Record<string, unknown>): Promise<T> {
    console.warn(`[Tauri Mock] invoke('${cmd}') called in browser mode with args:`, args);

    // Handle specific commands with sensible defaults
    if (cmd === 'get_os') {
      const userAgent = navigator.userAgent.toLowerCase();
      console.log(userAgent)
      if (userAgent.includes('mac')) {
        return 'macos' as T;
      } else if (userAgent.includes('linux')) {
        return 'linux' as T;
      } else {
        return 'windows' as T;
      }
    }

    console.warn('[Tauri Mock] Returning null - Tauri commands not available in web');
    return null as T;
  }

  async listen<T>(event: EventName, handler: EventCallback<T>, options?: Options): Promise<UnlistenFn> {
    console.warn(`[Tauri Mock] listen('${event}') called in browser mode`);
    return () => {};
  }

  async load(path: string): Promise<Store> {
    return load(path);
  }
}

/**
 * Desktop/Tauri implementation - calls real Tauri API
 */
export class DesktopTauriAPI extends TauriAPI {
  listen<T>(event: EventName, handler: EventCallback<T>, options?: Options): Promise<UnlistenFn> {
    return tauriListen(event, handler, options);
  }
  load(path: string): Promise<Store> {
    return tauriLoad(path);
  }
  async invoke<T = unknown>(cmd: string, args?: Record<string, unknown>): Promise<T> {
    return tauriInvoke<T>(cmd, args);
  }
}

// Singleton instance - lazily initialized
let tauriAPIInstance: TauriAPI | null = null;

/**
 * Get the appropriate TauriAPI implementation based on environment
 * Returns a singleton instance to ensure consistent behavior
 */
export function getTauriAPI(): TauriAPI {
  // Return cached instance if available
  if (tauriAPIInstance) {
    return tauriAPIInstance;
  }

  // @ts-ignore - Check if running in Tauri (desktop) or browser
  const isBrowser = typeof window !== 'undefined' && !window.__TAURI__;

  if (isBrowser) {
    tauriAPIInstance = new BrowserTauriMockAPI();
  } else {
    tauriAPIInstance = new DesktopTauriAPI();
  }

  return tauriAPIInstance;
}
