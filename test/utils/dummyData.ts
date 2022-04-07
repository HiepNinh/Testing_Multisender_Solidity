import { Signer } from "ethers";

export const buildDummyNativeCoin = async (
    user1: Signer,
    user2: Signer,
    user3: Signer,
    user4: Signer,
    user5: Signer
) => {
    return {
        [await user1.getAddress()]: 0.1,
        [await user2.getAddress()]: 0.2,
        [await user3.getAddress()]: 0.05,
        [await user4.getAddress()]: 0.6,
        [await user5.getAddress()]: 0.3
    }
}

export const buildDummyERC20 = async (
    user1: Signer,
    user2: Signer,
    user3: Signer,
    user4: Signer,
    user5: Signer
) => {
    return {
        [await user1.getAddress()]: 500,
        [await user2.getAddress()]: 800,
        [await user3.getAddress()]: 750,
        [await user4.getAddress()]: 1020,
        [await user5.getAddress()]: 670
    }
}

export const buildDummyNFT = async (
    user1: Signer,
    user2: Signer,
    user3: Signer,
    user4: Signer,
    user5: Signer
) => {
    return {
        [await user1.getAddress()]: [1, 3, 5],
        [await user2.getAddress()]: [2, 7, 9],
        [await user3.getAddress()]: [4],
        [await user4.getAddress()]: [8, 12],
        [await user5.getAddress()]: [6, 10, 11, 13, 14]
    }
}