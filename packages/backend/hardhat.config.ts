import * as dotenv from 'dotenv';
dotenv.config();

import { task, HardhatUserConfig } from 'hardhat/config';

import '@nomiclabs/hardhat-ethers';
import '@nomiclabs/hardhat-etherscan';
import '@nomiclabs/hardhat-waffle';
import '@typechain/hardhat';
import 'hardhat-gas-reporter';
import 'solidity-coverage';

import './tasks/minting';
import './tasks/tokens';
import './tasks/transferring';
import './tasks/verification';
import './tasks/withdrawing';

const {
  ALCHEMY_API_KEY = '',
  POLYGON_ALCHEMY_API_KEY = '',
  ETHERSCAN_API_KEY = '',
  // POLYGONSCAN_API_KEY = '',
  DEPLOYER_PRIVATE_KEY = '',
} = process.env;

task('accounts', 'Prints a list of all accounts', async (_, hre) => {
  const accounts = await hre.ethers.getSigners();
  for (const account of accounts) {
    console.log(account.address);
  }
});

task(
  'balances',
  'Prints a list of balances for all accounts',
  async (_, hre) => {
    hre.ethers
      .getSigners()
      .then((signers) => signers.map((signer) => signer.getBalance()));

    const accounts = await hre.ethers.getSigners();
    const balances = await Promise.all(
      accounts.map(
        async (acc) => [acc.address, await acc.getBalance()] as const,
      ),
    );

    for (const [address, balance] of balances) {
      console.log(address, '->', balance.toString());
    }
  },
);

const config: HardhatUserConfig = {
  solidity: {
    version: '0.8.4',
    settings: {
      optimizer: {
        enabled: true,
        runs: 1000,
      },
    },
  },
  networks: {
    mainnet: {
      url: `https://eth-mainnet.alchemyapi.io/v2/${ALCHEMY_API_KEY}`,
      accounts: [DEPLOYER_PRIVATE_KEY],
    },
    rinkeby: {
      url: `https://eth-rinkeby.alchemyapi.io/v2/${ALCHEMY_API_KEY}`,
      accounts: [DEPLOYER_PRIVATE_KEY],
    },
    ropsten: {
      url: `https://eth-ropsten.alchemyapi.io/v2/${ALCHEMY_API_KEY}`,
      accounts: [DEPLOYER_PRIVATE_KEY],
    },
    matic: {
      url: `https://polygon-mumbai.g.alchemy.com/v2/${POLYGON_ALCHEMY_API_KEY}`,
      accounts: [DEPLOYER_PRIVATE_KEY],
    },
  },
  gasReporter: {
    enabled: process.env.REPORT_GAS !== undefined,
    currency: 'USD',
  },
  etherscan: {
    apiKey: ETHERSCAN_API_KEY,
    // apiKey: POLYGONSCAN_API_KEY,
  },
};

export default config;
