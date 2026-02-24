let cryptoKey: CryptoKey | null = null
let cryptoInitialized = false

export async function initCrypto(): Promise<void> {
    const hash = window.location.hash
    if (!hash.startsWith("#key=")) {
        // No encryption key provided - encryption is optional
        console.log("[Crypto] No encryption key in URL, running without encryption")
        cryptoInitialized = true
        return
    }
    const keyHex = hash.slice(5)
    const keyBytes = hexToBytes(keyHex)
    if (keyBytes.length !== 32) {
        throw new Error(`Key must be 32 bytes (256 bits), got ${keyBytes.length}`)
    }
    cryptoKey = await crypto.subtle.importKey("raw", keyBytes, "AES-GCM", false, ["encrypt", "decrypt"])
    cryptoInitialized = true
    console.log("[Crypto] Encryption enabled")
}

export function isEncryptionEnabled(): boolean {
    return cryptoKey !== null
}

export async function encrypt(plaintext: Uint8Array): Promise<Uint8Array> {
    if (!cryptoInitialized) throw new Error("Crypto not initialized, call initCrypto() first")
    // If no key, return plaintext (no encryption)
    if (!cryptoKey) return plaintext
    const nonce = crypto.getRandomValues(new Uint8Array(12))
    const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, cryptoKey, plaintext)
    const result = new Uint8Array(12 + ciphertext.byteLength)
    result.set(nonce, 0)
    result.set(new Uint8Array(ciphertext), 12)
    return result
}

export async function decrypt(packet: Uint8Array): Promise<Uint8Array> {
    if (!cryptoInitialized) throw new Error("Crypto not initialized, call initCrypto() first")
    // If no key, return packet as-is (no decryption)
    if (!cryptoKey) return packet
    const nonce = packet.slice(0, 12)
    const ciphertext = packet.slice(12)
    const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv: nonce }, cryptoKey, ciphertext)
    return new Uint8Array(plaintext)
}

function hexToBytes(hex: string): Uint8Array {
    const bytes = new Uint8Array(hex.length / 2)
    for (let i = 0; i < bytes.length; i++) {
        bytes[i] = parseInt(hex.substr(i * 2, 2), 16)
    }
    return bytes
}
