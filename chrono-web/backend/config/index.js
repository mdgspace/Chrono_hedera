import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const testnetPath = path.resolve(__dirname, '../../../deployments/testnet.json');

dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

let contractAddresses = {};
try {
  contractAddresses = JSON.parse(fs.readFileSync(testnetPath, 'utf8'));
} catch (err) {
  console.warn("Could not load testnet.json deployments file:", err.message);
}

export const config = {
  PORT: process.env.PORT || 3001,
  HEDERA_TESTNET_RPC: process.env.HEDERA_TESTNET_RPC || 'https://testnet.hashio.io/api',
  PRIVATE_KEY: process.env.TESTNET_PRIVATE_KEY,
  SUPABASE_URL: process.env.SUPABASE_URL,
  SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY,
  addresses: contractAddresses
};
