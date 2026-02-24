import { PayloadEncryption } from './cryptoUtils';

class SecureClient {
  private encryption: PayloadEncryption;
  
  constructor(private sharedKey: string, private serverUrl: string) {
    this.encryption = new PayloadEncryption(sharedKey);
  }

  async sendSecureRequest(endpoint: string, data: any) {
    // Include the actual data plus any auth info in the payload
    const payload = {
      authKey: this.sharedKey,
      data: data
    };

    // Encrypt the entire payload
    const encryptedBody = this.encryption.encrypt(payload);

    try {
      // Send as plain HTTP with encrypted body
      const response = await fetch(
        `${this.serverUrl}${endpoint}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ encrypted: encryptedBody })
        }
      );

      // Check if response is ok
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      // Parse JSON response
      const responseData = await response.json();

      // Decrypt response if it's also encrypted
      if (responseData.encrypted) {
        return this.encryption.decrypt(responseData.encrypted);
      }
      
      return responseData;
    } catch (error) {
      console.error('Request failed:', error);
      throw error;
    }
  }

  // Optional: Add a method with timeout support
  async sendSecureRequestWithTimeout(
    endpoint: string, 
    data: any, 
    timeoutMs: number = 30000
  ) {
    // Include the actual data plus any auth info in the payload
    const payload = {
      timestamp: Date.now(),
      authKey: this.sharedKey,
      data: data
    };

    // Encrypt the entire payload
    const encryptedBody = this.encryption.encrypt(payload);

    // Create an AbortController for timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(
        `${this.serverUrl}${endpoint}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ encrypted: encryptedBody }),
          signal: controller.signal
        }
      );

      clearTimeout(timeoutId);

      if (!response.ok) {
        // Try to get error message from response
        const errorBody = await response.json().catch(() => null);

        // Extract error message from response body
        let errorMessage = `HTTP error! status: ${response.status}`;

        if (errorBody) {
          if (typeof errorBody.error === 'string') {
            errorMessage = errorBody.error;
          } else if (errorBody.error && typeof errorBody.error === 'object') {
            // Error is an object (e.g., { message: "...", stack: "..." })
            errorMessage = errorBody.error.message || JSON.stringify(errorBody.error);
          } else if (typeof errorBody === 'string') {
            errorMessage = errorBody;
          } else {
            errorMessage = JSON.stringify(errorBody);
          }
        }

        throw new Error(errorMessage);
      }

      const responseData = await response.json();

      // Decrypt response if it's also encrypted
      if (responseData.encrypted) {
        return this.encryption.decrypt(responseData.encrypted);
      }
      
      return responseData;
    } catch (error: any) {
      clearTimeout(timeoutId);
      
      // Handle different error types
      if (error.name === 'AbortError') {
        throw new Error(`Request timeout after ${timeoutMs}ms`);
      }
      
      console.error('Request failed:', error);
      throw error;
    }
  }
}

export { SecureClient };