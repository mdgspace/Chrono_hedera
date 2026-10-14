import { ethers } from "hardhat";
import fs from "fs";
import path from "path";
import { PythOracleAdapter } from "../typechain-types";
import { Client, TopicMessageSubmitTransaction, TopicId, AccountId, PrivateKey } from "@hiero-ledger/sdk";

// Price feed IDs used on Testnet
const PRICE_FEEDS = [
    // BTC/USD
    "e62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43",
    // ETH/USD
    "ff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace",
    // USDC/USD
    "eaa020c61cc479712813461ce153894a96a6c00b21ed0cfc2798d1f9a9e9c94a"
];

// Interval in milliseconds (e.g., 60 seconds)
const UPDATE_INTERVAL_MS = 60000;

async function main() {
    console.log("Starting Chrono Keeper Node...");
    
    // Load deployments
    const deployPath = path.join(__dirname, "../deployments/testnet.json");
    if (!fs.existsSync(deployPath)) {
        throw new Error("Deployments not found. Run deployment script first.");
    }
    const deployments = JSON.parse(fs.readFileSync(deployPath, "utf-8"));
    
    const oracleAddress = deployments["PythOracleAdapter"];
    if (!oracleAddress) {
        throw new Error("PythOracleAdapter deployment not found.");
    }
    
    // Setup signer using KEEPER_PRIVATE_KEY
    const keeperPrivateKey = process.env.KEEPER_PRIVATE_KEY;
    if (!keeperPrivateKey) throw new Error("KEEPER_PRIVATE_KEY not set in .env");
    const keeper = new ethers.Wallet(keeperPrivateKey, ethers.provider);
    console.log(`Using keeper address: ${keeper.address}`);
    // Load contract
    const pythAdapter = await ethers.getContractAt("PythOracleAdapter", oracleAddress, keeper) as unknown as PythOracleAdapter;

    // Verify keeper role
    const currentKeeper = await pythAdapter.keeper();
    if (currentKeeper.toLowerCase() !== keeper.address.toLowerCase()) {
        throw new Error(`Unauthorized: Signer is not the configured keeper. Current keeper: ${currentKeeper}`);
    }

    console.log(`Connected to Oracle Adapter at ${oracleAddress}`);
    console.log(`Watching ${PRICE_FEEDS.length} feeds every ${UPDATE_INTERVAL_MS}ms...`);

    // Setup HCS Audit Stream Listener
    const topicIdStr = deployments["HCS_AUDIT_TOPIC_ID"] || process.env.HCS_AUDIT_TOPIC_ID;
    const operatorIdStr = process.env.HEDERA_OPERATOR_ID || process.env.HEDERA_ACCOUNT_ID || process.env.OPERATOR_ID;
    const operatorKeyStr = process.env.HEDERA_OPERATOR_KEY || process.env.TESTNET_PRIVATE_KEY || process.env.OPERATOR_KEY;

    let hieroClient: Client | null = null;
    if (topicIdStr && operatorIdStr && operatorKeyStr) {
        try {
            const operatorId = AccountId.fromString(operatorIdStr);
            let operatorKey: PrivateKey;
            try {
                operatorKey = PrivateKey.fromStringECDSA(operatorKeyStr);
            } catch {
                operatorKey = PrivateKey.fromString(operatorKeyStr);
            }
            hieroClient = Client.forTestnet().setOperator(operatorId, operatorKey);
            console.log(`[HCS] Initialized Hiero client for Audit Topic: ${topicIdStr}`);
        } catch (err: any) {
            console.warn(`[HCS] Failed to initialize Hiero client: ${err.message}`);
        }
    } else {
        console.log("[HCS] Audit topic or operator credentials not configured; HCS event submission disabled.");
    }

    const interestEngineAddress = deployments["InterestEngine"];
    if (interestEngineAddress && topicIdStr && hieroClient) {
        const topicId = TopicId.fromString(topicIdStr);
        const interestEngine = await ethers.getContractAt("InterestEngine", interestEngineAddress);

        console.log(`[HCS] Subscribing to IndexSnapshot events on InterestEngine at ${interestEngineAddress}...`);
        interestEngine.on("IndexSnapshot", async (token: string, borrowIndex: any, borrowAPY: any, utilization: any, timestamp: any, event: any) => {
            try {
                const payload = JSON.stringify({
                    protocol: "Chrono",
                    event: "IndexSnapshot",
                    token,
                    borrowIndex: borrowIndex.toString(),
                    borrowAPY: borrowAPY.toString(),
                    utilization: utilization.toString(),
                    blockTimestamp: Number(timestamp),
                    txHash: event?.log?.transactionHash || ""
                });

                const submitTx = await new TopicMessageSubmitTransaction()
                    .setTopicId(topicId)
                    .setMessage(payload)
                    .execute(hieroClient!);

                const receipt = await submitTx.getReceipt(hieroClient!);
                console.log(`[HCS] Audit Snapshot emitted for ${token}: seq #${receipt.topicSequenceNumber}`);
            } catch (err: any) {
                console.error("[HCS] Failed to submit HCS audit message:", err.message);
            }
        });
    }

    // Main event loop
    setInterval(async () => {
        try {
            console.log("\n[KEEPER] Fetching price updates from Hermes...");
            const url = "https://hermes.pyth.network/v2/updates/price/latest?" + PRICE_FEEDS.map(id => "ids[]=" + id).join("&");
            const res = await fetch(url);
            const json = await res.json();
            
            const rawData = json?.binary?.data;
            if (!rawData || rawData.length === 0) {
                console.warn("[KEEPER] No update data received.");
                return;
            }
            
            // Format for ethers
            const priceUpdateData = rawData.map((hex: string) => hex.startsWith("0x") ? hex : "0x" + hex);

            console.log("[KEEPER] Fetching update fee...");
            const fee = await pythAdapter.getUpdateFee(priceUpdateData);
            
            // Add large margin because Hedera truncates WEI < 1e10 (1 tinybar) to 0.
            // 0.01 HBAR (1e16 WEI) is very safe and gets refunded by adapter.
            const feeWithMargin = fee + ethers.parseEther("0.01");
            
            console.log(`[KEEPER] Pushing update on-chain. Fee required: ${ethers.formatEther(feeWithMargin)} HBAR...`);
            const tx = await pythAdapter.updatePrice(priceUpdateData, { value: feeWithMargin });
            
            const receipt = await tx.wait();
            console.log(`[KEEPER] Update successful! Tx hash: ${receipt?.hash}`);
            
        } catch (error: any) {
            console.error("[KEEPER] Error during update cycle:", error.message || error);
        }
    }, UPDATE_INTERVAL_MS);
    
    // Keep process running
    await new Promise(() => {});
}

main().catch(error => {
    console.error("Fatal Error:", error);
    process.exitCode = 1;
});
