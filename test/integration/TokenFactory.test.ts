import { expect } from "chai";
import { ethers } from "hardhat";
import { WrappedTokenFactory } from "../../typechain-types";

describe("TokenFactory Integration [Testnet]", function () {
    let factory: WrappedTokenFactory;

    before(async function () {
        // Only run on testnet
        const network = await ethers.provider.getNetwork();
        if (network.chainId !== 296n) {
            this.skip();
        }

        const Factory = await ethers.getContractFactory("WrappedTokenFactory");
        factory = await Factory.deploy();
        await factory.waitForDeployment();
    });

    it("should create a new HTS token on testnet", async function () {
        const fee = ethers.parseEther("30"); // Ensure sufficient HBAR for token creation (HTS fee is ~20 HBAR)

        const tx = await factory.createWrappedToken(
            "Test Token",
            "TST",
            8,
            10000n * 10n**8n, // 10,000 TST
            { value: fee }
        );

        const receipt = await tx.wait();
        const event = receipt?.logs.find((l: any) => l.fragment?.name === "TokenCreated") as any;
        
        expect(event).to.not.be.undefined;
        // The factory (treasury) should now have the initial supply
        const tokenAddr = event.args.tokenAddress;
        
        // Associate deployer with the new token via HTS precompile (0x167)
        const htsAddress = "0x0000000000000000000000000000000000000167";
        const htsAbi = [
            "function associateTokens(address account, address[] memory tokens) external returns (int64)"
        ];
        const hts = await ethers.getContractAt(htsAbi, htsAddress);
        const [deployer] = await ethers.getSigners();
        
        let assocTx = await hts.associateTokens(deployer.address, [tokenAddr]);
        await assocTx.wait();
        
        // Transfer tokens from factory to deployer
        let transferTx = await factory.transferTokens(tokenAddr, deployer.address, 10000n * 10n**8n);
        await transferTx.wait();

        const ERC20 = await ethers.getContractAt("IERC20", tokenAddr);
        const balance = await ERC20.balanceOf(deployer.address);
        
        expect(balance).to.equal(10000n * 10n**8n);
    });
});
