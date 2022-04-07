import * as dotenv from "dotenv";

import { HardhatUserConfig } from "hardhat/config";
import "@nomiclabs/hardhat-etherscan";
import "@nomiclabs/hardhat-waffle";
import "@openzeppelin/hardhat-upgrades";
import "@typechain/hardhat";
import "hardhat-gas-reporter";
import "solidity-coverage";
import "hardhat-tracer";

dotenv.config();

// You need to export an object to set up your config
// Go to https://hardhat.org/config/ to learn more

const config: HardhatUserConfig = {
  solidity: {
    compilers: [
      {
        version: "0.8.9",
        settings: {
          optimizer: {
            enabled: true,
            runs: 200,
          },
        },
      },
      {
        version: "0.6.12",
        settings: {
          optimizer: {
            enabled: true,
            runs: 200,
          },
        },
      },
    ],
  },
  networks: {
    rinkeby: {
      url: `https://eth-rinkeby.alchemyapi.io/v2/7z572lXXuyfpl4wcS-faR81Oyobzb8Pj`,
      accounts: [
        process.env.PRIVATE_KEY_DEPLOYER!
      ],
    },
    kovan: {
      url: `https://kovan.infura.io/v3/57bcc53fd8024abfac8c01b0bd18d12b`,
      accounts: [
        process.env.PRIVATE_KEY_DEPLOYER!
      ],
    },
    matic: {
      url: `https://apis.ankr.com/e22bfa5f5a124b9aa1f911b742f6adfe/c06bb163c3c2a10a4028959f4d82836d/polygon/full/main`,
      accounts: [
        process.env.PRIVATE_KEY_DEPLOYER!
      ],
    },
    goerli: {
      url: "https://eth-goerli.alchemyapi.io/v2/7z572lXXuyfpl4wcS-faR81Oyobzb8Pj",
      accounts: [
        process.env.PRIVATE_KEY_DEPLOYER!
      ],
    },
    bsc_testnet: {
      url: "https://speedy-nodes-nyc.moralis.io/17eceb0bdb2ae01de18c99fb/bsc/testnet",
      accounts: [
        process.env.PRIVATE_KEY_DEPLOYER!
      ],
    },
    bsc_mainnet: {
      url: "https://speedy-nodes-nyc.moralis.io/17eceb0bdb2ae01de18c99fb/bsc/mainnet",
      accounts: [
        process.env.PRIVATE_KEY_DEPLOYER!
      ],
    },
    mumbai: {
      url: "https://polygon-mumbai.g.alchemy.com/v2/7z572lXXuyfpl4wcS-faR81Oyobzb8Pj",
      accounts: [
        process.env.PRIVATE_KEY_DEPLOYER!
      ],
    },
    arbitrum_rinkeby: {
      url: "https://arbitrum-rinkeby.infura.io/v3/bf7ca7329c7c4b04b73e3883a2f07f60",
      chainId: 421611,
      accounts: [
        process.env.PRIVATE_KEY_DEPLOYER!
      ]
    },
    arbitrum_mainnet: {
      url: "https://arbitrum-mainnet.infura.io/v3/bf7ca7329c7c4b04b73e3883a2f07f60",
      chainId: 42161,
      accounts: [
        process.env.PRIVATE_KEY_DEPLOYER!
      ]
    }
  },
  gasReporter: {
    enabled: true,
    currency: "USD",
  },
  etherscan: {
    // Your API key for Etherscan
    // Obtain one at https://bscscan.com/
    apiKey: process.env.BSCSCAN_APIKEY
  },
};

export default config;
