import { PayloadEncryption } from "./cryptoUtils";

const isLocal = process.argv.length >= 2 ? process.argv[1] == '--local' : false;  
const SHARED_KEY = isLocal ? 'no-secret-its-local-:)' : (process.env.SHARED_KEY ?? 'default-bad');
export const encryption = new PayloadEncryption(SHARED_KEY);