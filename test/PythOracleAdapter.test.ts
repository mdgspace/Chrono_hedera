import { expect } from "chai";
import hre, { ethers } from "hardhat";
import { type PythOracleAdapter, type MockPyth, type PythTestHelper } from "../typechain-types";
import { type SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";

describe("PythOracleAdapter", function () {
    let adapter: PythOracleAdapter;
    let mockPyth: MockPyth;
    let helper: PythTestHelper;
    let owner: SignerWithAddress;
    let user: SignerWithAddress;
    
    const BTC_ID = "0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43";
    const MOCK_TOKEN = "0x0000000000000000000000000000000000000001";

    beforeEach(async function () {
        [owner, user] = await ethers.getSigners();
        
        const MockPythFactory = await ethers.getContractFactory("MockPyth");
        mockPyth = (await MockPythFactory.deploy(60, 100)) as any;

        const AdapterFactory = await ethers.getContractFactory("PythOracleAdapter");
        adapter = (await AdapterFactory.deploy(await mockPyth.getAddress())) as any;

        const HelperFactory = await ethers.getContractFactory("PythTestHelper");
        helper = (await HelperFactory.deploy()) as any;

        await adapter.registerPriceFeed(MOCK_TOKEN, BTC_ID);
        await adapter.setKeeper(owner.address);
    });

    it("should revert if negative price", async function () {
        const publishTime = (await ethers.provider.getBlock("latest"))!.timestamp;
        const updateData = await helper.createUpdateData(BTC_ID, -50000, -8, publishTime);

        await adapter.connect(owner).updatePrice([updateData], { value: 100 });
        await expect(adapter.getPrice(MOCK_TOKEN)).to.be.revertedWithCustomError(adapter, "NegativePrice");
    });

    it("should revert if stale", async function () {
        const publishTime = (await ethers.provider.getBlock("latest"))!.timestamp - 130;
        const updateData = await helper.createUpdateData(BTC_ID, 50000, -8, publishTime);

        await adapter.connect(owner).updatePrice([updateData], { value: 100 });
        await expect(adapter.getPrice(MOCK_TOKEN)).to.be.revertedWithCustomError(adapter, "StalePrice");
    });

    it("should normalize negative expo correctly", async function () {
        const publishTime = (await ethers.provider.getBlock("latest"))!.timestamp;
        // Price = 50,000, expo = -2. True price is 500.
        const updateData = await helper.createUpdateData(BTC_ID, 50000, -2, publishTime);

        await adapter.connect(owner).updatePrice([updateData], { value: 100 });
        
        const expectedPrice = ethers.parseUnits("500", 18);
        expect(await adapter.getPrice(MOCK_TOKEN)).to.equal(expectedPrice);
    });

    it("should normalize positive expo correctly", async function () {
        const publishTime = (await ethers.provider.getBlock("latest"))!.timestamp;
        // Price = 5, expo = +2. True price is 500.
        const updateData = await helper.createUpdateData(BTC_ID, 5, 2, publishTime);

        await adapter.connect(owner).updatePrice([updateData], { value: 100 });
        
        const expectedPrice = ethers.parseUnits("500", 18);
        expect(await adapter.getPrice(MOCK_TOKEN)).to.equal(expectedPrice);
    });

    it("should refund excess fee", async function () {
        const publishTime = (await ethers.provider.getBlock("latest"))!.timestamp;
        const updateData = await helper.createUpdateData(BTC_ID, 5, 2, publishTime);

        // Send 1000 wei instead of 100
        const tx = await adapter.connect(owner).updatePrice([updateData], { value: 1000 });
        await expect(tx).to.changeEtherBalances([owner, mockPyth], [-100, 100]);
    });
});
