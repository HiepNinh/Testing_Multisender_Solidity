
import { ethers } from "hardhat";
import { Signer } from "ethers";
import Safe, { ContractNetworksConfig } from "@gnosis.pm/safe-core-sdk";
import EthersAdapter, { EthersAdapterConfig } from '@gnosis.pm/safe-ethers-lib'; 
import { SafeTransaction } from '@gnosis.pm/safe-core-sdk-types';
import SafeSignature from "@gnosis.pm/safe-core-sdk/dist/src/utils/signatures/SafeSignature";


export async function getContractNetworks(
    chainId: number,
    signer: Signer
): Promise<ContractNetworksConfig> {
    // deloy Safe MultiSend - MasterCopy - ProxyFactory
    const multiSendFactory = await ethers.getContractFactory("MultiSend");
    const masterCopyFactory = await ethers.getContractFactory("GnosisSafeL2");
    const gnosisSafeProxyFactory = await ethers.getContractFactory("GnosisSafeProxyFactory");

    const multisend = await multiSendFactory.connect(signer).deploy();
    const masterCopy = await masterCopyFactory.connect(signer).deploy();
    const gnosisSafeProxy = await gnosisSafeProxyFactory.connect(signer).deploy();
    await Promise.all([
        multisend.deployTransaction.wait(45),
        masterCopy.deployTransaction.wait(45),
        gnosisSafeProxy.deployTransaction.wait(45)
    ]);

    return {
      [chainId]: {
        multiSendAddress: multisend.address,
        safeMasterCopyAddress: masterCopy.address,
        safeProxyFactoryAddress: gnosisSafeProxy.address
      }
    }
  }

  export async function getEthersAdapter(signer: Signer): Promise<EthersAdapter> {
    let ethersAdapter: EthersAdapter
    switch (process.env.ETH_LIB) {
    //   case 'web3':
    //     const signerAddress = await signer.getAddress()
    //     const web3AdapterConfig: Web3AdapterConfig = { web3: web3 as any, signerAddress }
    //     ethAdapter = new Web3Adapter(web3AdapterConfig)
    //     break
      case 'ethers':
        const ethersAdapterConfig: EthersAdapterConfig = { ethers, signer }
        ethersAdapter = new EthersAdapter(ethersAdapterConfig)
        break
      default:
        throw new Error('Ethereum library not supported')
    }
    return ethersAdapter
  }

  // data come from safeTransaction.signatures.get([signer])
  export const addingSignature = async (
    safeTransaction: SafeTransaction,
    signer: string | undefined,
    data: string | undefined
) => {
    if(!signer || !data) throw new Error("Invalid signer or signature");
    safeTransaction.addSignature(new SafeSignature(
        signer,
        data
    ))
}

export const signOnline = async (
    safeSdk: Safe,
    safeTransaction: SafeTransaction
) => {
    const txHash = await safeSdk.getTransactionHash(safeTransaction)
    const approveTxResponse = await safeSdk.approveTransactionHash(txHash)
    await approveTxResponse.transactionResponse?.wait(45)
}

export const signOffline = async (
    safeSdk: Safe,
    safeTransaction: SafeTransaction
) => {
    await safeSdk.signTransaction(safeTransaction)
}