/**
 * Device fingerprinting for anonymous user identification
 * Uses ThumbmarkJS for browser fingerprinting
 */

import { Thumbmark } from '@thumbmarkjs/thumbmarkjs';

export interface DeviceFingerprint {
  primary: string;      // Thumbmark hash or machine ID
  fallback: string;     // localStorage UUID
  platform: 'browser' | 'desktop';
}

/**
 * Generate device fingerprint for browser
 */
async function getBrowserFingerprint(): Promise<DeviceFingerprint> {
  try {
    // Get ThumbmarkJS fingerprint
    const tm = new Thumbmark({
      timeout: 3000,
      logging: false,
      // Stabilize for private browsing and iframes
      stabilize: ['private', 'iframe'],
      // Exclude slow components for faster fingerprinting
      exclude: []
    });

    const result = await tm.get();
    const primary = result.hash;

    // Fallback: localStorage UUID
    let fallback = localStorage.getItem('ariana_device_uuid');
    if (!fallback) {
      fallback = crypto.randomUUID();
      localStorage.setItem('ariana_device_uuid', fallback);
    }

    return {
      primary,
      fallback,
      platform: 'browser'
    };
  } catch (error) {
    console.error('[Fingerprint] Failed to get browser fingerprint:', error);

    // Fallback-only mode
    let fallback = localStorage.getItem('ariana_device_uuid');
    if (!fallback) {
      fallback = crypto.randomUUID();
      localStorage.setItem('ariana_device_uuid', fallback);
    }

    return {
      primary: fallback, // Use UUID as primary if fingerprinting fails
      fallback,
      platform: 'browser'
    };
  }
}

/**
 * Generate device fingerprint for desktop (Tauri)
 */
async function getDesktopFingerprint(): Promise<DeviceFingerprint> {
  try {
    const { invoke } = await import('@tauri-apps/api/core');

    // Get machine ID from Rust
    const machineId = await invoke<string>('get_machine_id');

    // Get or create UUID stored in app data
    const deviceUuid = await invoke<string>('get_device_uuid');

    return {
      primary: machineId,
      fallback: deviceUuid,
      platform: 'desktop'
    };
  } catch (error) {
    console.error('[Fingerprint] Failed to get desktop fingerprint:', error);
    throw error;
  }
}

/**
 * Get device fingerprint (auto-detects platform)
 */
export async function getDeviceFingerprint(): Promise<DeviceFingerprint> {
  // Detect if running in Tauri
  const isTauri = '__TAURI__' in window;

  if (isTauri) {
    return getDesktopFingerprint();
  } else {
    return getBrowserFingerprint();
  }
}

/**
 * Create anonymous identifier from fingerprint
 * This is what gets sent to the backend
 */
export function createAnonymousIdentifier(fingerprint: DeviceFingerprint): string {
  // Combine primary and fallback for uniqueness
  return `${fingerprint.platform}:${fingerprint.primary}:${fingerprint.fallback}`;
}
