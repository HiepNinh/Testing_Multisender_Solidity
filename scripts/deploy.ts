// We require the Hardhat Runtime Environment explicitly here. This is optional
// but useful for running the script in a standalone fashion through `node <script>`.
//
// When running the script with `npx hardhat run <script>` you'll find the Hardhat
// Runtime Environment's members available in the global scope.
import { ethers, upgrades } from "hardhat";
import { BigNumber } from "@ethersproject/bignumber";
import EthersAdapter from '@gnosis.pm/safe-ethers-lib'; 
import { getContractNetworks, getEthersAdapter } from '../test/utils/safeGnosis'
import Safe, { SafeFactory, SafeAccountConfig } from '@gnosis.pm/safe-core-sdk';

async function main() {
  // Hardhat always runs the compile task when running scripts with its command
  // line interface.
  //
  // If this script is run directly using `node` you may want to call compile
  // manually to make sure everything is compiled
  // await hre.run('compile');
  const [deployer, admin1, admin2] = await ethers.getSigners();
  const DELAY_IN_HOUR = 3600;

  // Setup Gnosis Safe
  // Setup Contract Network for Gnosis Safe on current chainId
  const { chainId } = await ethers.provider.getNetwork();
  let contractNetworks = await getContractNetworks(chainId, deployer);

  const deployerEthAdapter: EthersAdapter = await getEthersAdapter(deployer);
  const safeFactory = await SafeFactory.create({ ethAdapter: deployerEthAdapter, contractNetworks });
  const owners = [ await deployer.getAddress(), await admin1.getAddress(), await admin2.getAddress() ];
  const threshold = owners.length - 1;
  const safeAccountConfig: SafeAccountConfig = {
      owners,
      threshold
  };
  // deploy safe
  const safeSdk: Safe = await safeFactory.deploySafe({ safeAccountConfig });
  let safeAddress = safeSdk.getAddress();
  console.log("safeAddress: ", safeAddress)

  // deploy OwnedTimelockController
  const OwnedTimeLockFactory = await ethers.getContractFactory("OwnedTimelockController")
  const adminTimelock = await OwnedTimeLockFactory.deploy(
      BigNumber.from(DELAY_IN_HOUR),
      [safeAddress],
      [safeAddress]
  );
  let proxyTimelockAddress = adminTimelock.address;
  console.log("proxyTimelockAddress: ", proxyTimelockAddress)

  // deploy multisender
  const MultiSenderFactory = await ethers.getContractFactory("Multisender");
  const multisenderProxy = await upgrades.deployProxy(MultiSenderFactory, [
      "Multisender",
      "1.0.0",
      BigNumber.from(Date.now()),
      BigNumber.from(DELAY_IN_HOUR),
      [safeAddress],
      [safeAddress]
  ], {
      initializer: 'initialize',
  });
  let proxy = multisenderProxy.address;
  console.log("Multisender (proxy): ", proxy)

   // Store ProxyAdmin contract's address
   // using for upgrade version of contract
   let proxyAdminContractAdress = (await upgrades.admin.getInstance()).address;
   console.log("proxyAdminContractAdress: ", proxyAdminContractAdress)

   // Transfer ownership to Gnosis
   await upgrades.admin.transferProxyAdminOwnership(proxyTimelockAddress);
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
