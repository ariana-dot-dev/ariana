import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const TAG_LENGTH = 16;

export class PayloadEncryption {
    private key: Buffer;

    constructor(private sharedSecret: string) {
        // Derive a 256-bit key from your shared secret
        this.key = createHash('sha256').update(sharedSecret).digest();
    }

    encrypt(payload: any): string {
        // Convert payload to JSON string
        const plaintext = JSON.stringify(payload);
        // console.log(`[ENCRYPT] Plaintext size: ${plaintext.length} bytes`);

        // Generate random IV
        const iv = randomBytes(IV_LENGTH);

        // Create cipher
        const cipher = createCipheriv(ALGORITHM, this.key, iv);

        // Encrypt the data
        const encrypted = Buffer.concat([
            cipher.update(plaintext, 'utf8'),
            cipher.final()
        ]);

        // Get the auth tag
        const authTag = cipher.getAuthTag();

        // Combine salt + iv + authTag + encrypted data
        const combined = Buffer.concat([
            iv,
            authTag,
            encrypted
        ]);

        // Return base64 encoded
        const result = combined.toString('base64');
        // console.log(`[ENCRYPT] Encrypted+base64 size: ${result.length} bytes`);
        return result;
    }

    decrypt(encryptedData: string): any {
        try {
            // console.log(`[DECRYPT] Encrypted data size: ${encryptedData.length} bytes`);
            // console.log(`[DECRYPT] First 100 chars: ${encryptedData.substring(0, 100)}`);
            // console.log(`[DECRYPT] Last 100 chars: ${encryptedData.substring(Math.max(0, encryptedData.length - 100))}`);

            // Decode from base64
            const combined = Buffer.from(encryptedData, 'base64');

            // Extract components
            const iv = combined.subarray(0, IV_LENGTH);
            const authTag = combined.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
            const encrypted = combined.subarray(IV_LENGTH + TAG_LENGTH);

            // Create decipher
            const decipher = createDecipheriv(ALGORITHM, this.key, iv);
            decipher.setAuthTag(authTag);

            // Decrypt
            const decrypted = Buffer.concat([
                decipher.update(encrypted),
                decipher.final()
            ]);

            const decryptedString = decrypted.toString('utf8');
            // console.log(`[DECRYPT] Decrypted string size: ${decryptedString.length} bytes`);
            // console.log(`[DECRYPT] Decrypted first 200 chars: ${decryptedString.substring(0, 200)}`);
            // console.log(`[DECRYPT] Decrypted last 200 chars: ${decryptedString.substring(Math.max(0, decryptedString.length - 200))}`);

            // Parse JSON and return
            return JSON.parse(decryptedString);
        } catch (error) {
            console.error(`[DECRYPT] ERROR:`, error);
            throw new Error('Decryption failed: Invalid data or wrong key');
        }
    }

    async decryptAndValidate<T>(body: any): Promise<{ valid: boolean; data?: T; error?: string }> {
        try {
            if (!body.encrypted) {
                return { valid: false, error: 'No encrypted data provided' };
            }

            const decrypted = this.decrypt(body.encrypted);

            // Validate auth key
            if (decrypted.authKey !== this.sharedSecret) {
                return { valid: false, error: 'Invalid authentication' };
            }

            return { valid: true, data: decrypted.data };
        } catch (error) {
            console.error('Decryption error:', error);
            return { valid: false, error: 'Invalid encrypted payload' };
        }
    }
}
