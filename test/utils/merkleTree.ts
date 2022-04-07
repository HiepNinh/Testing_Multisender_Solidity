import { ethers } from "hardhat";
import { MerkleTree } from "merkletreejs";
const keccak256 = require('keccak256');

export const getHash = (kycAddress: string, DOMAIN_SEPARATOR: any) => {
    return ethers.utils.keccak256(
        ethers.utils.solidityPack(
            ['bytes1', 'bytes1', 'bytes32', 'bytes32'],
            [
                '0x19',
                '0x01',
                DOMAIN_SEPARATOR,
                ethers.utils.keccak256(
                    ethers.utils.defaultAbiCoder.encode(
                        ['address'],
                        [kycAddress]
                    )
                )
            ]
        )
    )
}

export const buildMerkleTree = (kycAddresses: string[], DOMAIN_SEPARATOR: any) => {
    const leaves = [...kycAddresses.map(value => getHash(value, DOMAIN_SEPARATOR))].map(value => keccak256(value));

    return new MerkleTree(leaves, keccak256, {
        sortLeaves: true,
        sortPairs: true
    });
}