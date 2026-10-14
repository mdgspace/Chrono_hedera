import { expect } from "chai";
import { ethers } from "hardhat";
import { type InterestEngine, type MockLendingPool, type AssetRegistry } from "../typechain-types";
import { type SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import { time } from "@nomicfoundation/hardhat-network-helpers";

describe("HCS Real-Time Audit Stream", function () {
    let engine: InterestEngine;
    let mockPool: MockLendingPool;
    let registry: AssetRegistry;
    let owner: SignerWithAddress;
    
    const TOKEN_STABLE = "0x0000000000000000000000000000000000000001";

    beforeEach(async function () {
        [owner] = await ethers.getSigners();
        
        const RegistryFactory = await ethers.getContractFactory("AssetRegistry");
        registry = await RegistryFactory.deploy(owner.address) as any;
        
        const PoolFactory = await ethers.getContractFactory("MockLendingPool");
        mockPool = await PoolFactory.deploy() as any;

        const EngineFactory = await ethers.getContractFactory("InterestEngine");
        engine = await EngineFactory.deploy(await mockPool.getAddress(), await registry.getAddress(), owner.address) as any;

        await registry.registerAsset({
            tokenAddress: TOKEN_STABLE,
            decimals: 8,
            isStablecoin: true,
            ltvBase: 0, ltvMax: 0, kDecay: 0, liquidationBonus: 0, closeFactor: 0,
            ltBufferMin: 0, ltBufferMax: 0, kLtBuffer: 0, hardLiqPenalty: 0,
            hardLiqCollateralFloor: 0, stabilityPoolPenaltyShare: 0, reservePenaltyShare: 0,
            minBorrowDuration: 0, maxBorrowDuration: 0, isActive: false
        });
    });

    it("should format and serialize IndexSnapshot payload adhering to HCS topic schema", async function () {
        // Initialize reserve index
        await engine.updateReserveIndices(TOKEN_STABLE);

        // Advance 1 hour and advance index to trigger snapshot event
        await time.increase(3600);
        const tx = await engine.updateReserveIndices(TOKEN_STABLE);
        const receipt = await tx.wait();

        // Extract IndexSnapshot event
        const snapshotFilter = engine.filters.IndexSnapshot();
        const events = await engine.queryFilter(snapshotFilter, receipt?.blockNumber, receipt?.blockNumber);
        expect(events.length).to.equal(1);

        const event = events[0];
        const [token, borrowIndex, borrowAPY, utilization, timestamp] = event.args;

        // Build HCS JSON payload identical to scripts/keeper.ts
        const payloadStr = JSON.stringify({
            protocol: "Chrono",
            event: "IndexSnapshot",
            token,
            borrowIndex: borrowIndex.toString(),
            borrowAPY: borrowAPY.toString(),
            utilization: utilization.toString(),
            blockTimestamp: Number(timestamp),
            txHash: event.transactionHash
        });

        const parsed = JSON.parse(payloadStr);
        expect(parsed.protocol).to.equal("Chrono");
        expect(parsed.event).to.equal("IndexSnapshot");
        expect(parsed.token).to.equal(TOKEN_STABLE);
        expect(BigInt(parsed.borrowIndex)).to.be.gt(ethers.parseEther("1.0"));
        expect(parsed.txHash).to.equal(tx.hash);
        expect(parsed.blockTimestamp).to.be.a("number");

        // Verify message fits comfortably within Hedera HCS individual message limit (1024 bytes)
        const payloadBytes = Buffer.from(payloadStr, "utf-8");
        expect(payloadBytes.length).to.be.lessThan(1024);
        expect(payloadBytes.length).to.be.greaterThan(50);
    });
});
