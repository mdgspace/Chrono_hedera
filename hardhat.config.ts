import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox-mocha-ethers";

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.24",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
      },
    },
  },
  networks: {
    testnet: {
      type: "http",
      url: "https://testnet.hashio.io/api",
      chainId: 296,
      // accounts managed via built-in keystore plugin (`npx hardhat keystore set HEDERA_PRIVATE_KEY`)
    },
  },
};

export default config;
