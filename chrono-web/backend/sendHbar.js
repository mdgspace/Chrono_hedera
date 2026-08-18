import { ethers } from 'ethers';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '../../.env') });

const rpcUrl = "https://testnet.hashio.io/api";
const provider = new ethers.JsonRpcProvider(rpcUrl);

const pkey = process.env.KEEPER_PRIVATE_KEY;
if (!pkey) throw new Error("No KEEPER_PRIVATE_KEY in .env");

const wallet = new ethers.Wallet(pkey, provider);
const to = "0xf1f8f703d72821c6a933cc860ff57b0ed1dfbe3c";
const amount = "300";

async function main() {
    console.log(`Send ${amount} HBAR from ${wallet.address} to ${to}...`);
    const tx = await wallet.sendTransaction({
        to: to,
        value: ethers.parseEther(amount)
    });
    console.log(`Tx hash: ${tx.hash}`);
    await tx.wait();
    console.log("Confirmed.");
}

main().catch(console.error);
