import { Client, TopicCreateTransaction, AccountId, PrivateKey } from "@hiero-ledger/sdk";
import fs from "fs";
import path from "path";
import dotenv from "dotenv";

dotenv.config();

export async function createAuditTopic(): Promise<string> {
    const operatorIdStr = process.env.HEDERA_OPERATOR_ID || process.env.HEDERA_ACCOUNT_ID || process.env.OPERATOR_ID;
    const operatorKeyStr = process.env.HEDERA_OPERATOR_KEY || process.env.TESTNET_PRIVATE_KEY || process.env.OPERATOR_KEY;

    if (!operatorIdStr || !operatorKeyStr) {
        throw new Error("Missing operator credentials: set HEDERA_OPERATOR_ID and HEDERA_OPERATOR_KEY in .env");
    }

    const operatorId = AccountId.fromString(operatorIdStr);
    let operatorKey: PrivateKey;
    try {
        operatorKey = PrivateKey.fromStringECDSA(operatorKeyStr);
    } catch {
        operatorKey = PrivateKey.fromString(operatorKeyStr);
    }

    const client = Client.forTestnet().setOperator(operatorId, operatorKey);

    console.log("Creating Chrono Protocol Audit Topic on HCS...");
    const tx = await new TopicCreateTransaction()
        .setTopicMemo("Chrono Protocol - Interest Rate & Cumulative Index Audit Trail")
        .setAdminKey(operatorKey)
        .setSubmitKey(operatorKey)
        .execute(client);

    const receipt = await tx.getReceipt(client);
    const topicId = receipt.topicId!.toString();
    console.log("HCS Topic created successfully:", topicId);

    // Persist topicId in deployments/testnet.json
    const deploymentsPath = path.join(__dirname, "../../deployments/testnet.json");
    let deployments: any = {};
    if (fs.existsSync(deploymentsPath)) {
        deployments = JSON.parse(fs.readFileSync(deploymentsPath, "utf-8"));
    }
    deployments["HCS_AUDIT_TOPIC_ID"] = topicId;
    fs.writeFileSync(deploymentsPath, JSON.stringify(deployments, null, 2));
    console.log("Saved HCS_AUDIT_TOPIC_ID to deployments/testnet.json");

    return topicId;
}

if (require.main === module) {
    createAuditTopic().catch((error) => {
        console.error("Fatal Error:", error);
        process.exitCode = 1;
    });
}
