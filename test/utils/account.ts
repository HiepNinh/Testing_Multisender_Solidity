import { Signer } from "ethers";
import { ethers } from "hardhat";
import _ from "lodash";
import { Multisender, BasicERC20, BasicERC721 } from "../../typechain";

let signers: Signer[];

export const setupAddress = async () => {
    signers = await ethers.getSigners();

    return signers;
}

export const mintForReceiver = async (
    token: BasicERC20,
    nft721: BasicERC721,
    dropingToken: any,
    dropingNft: any,
    signer: Signer,
    receiver: string
) => {
    const mintTokenAmount = _.sumBy(_.values(dropingToken));
    const mintTokenTx = await token.connect(signer).mint(receiver, ethers.utils.parseEther(mintTokenAmount.toString()));

    const token721Ids = _.concat(..._.values(dropingNft));
    const mintToken721Txs = [];
    for(let i = 0; i < token721Ids.length; i++) {
        const tx = await nft721.connect(signer).mint(receiver, token721Ids[i]);
        mintToken721Txs.push(tx.wait());
    }

    await Promise.all([
        mintTokenTx.wait(),
        ...mintToken721Txs,
    ]);
}

export const approveForAll = async (
    token: BasicERC20,
    nft721: BasicERC721,
    contract: string,
    signer: Signer
) => {
    const approveTokenTx = await token.connect(signer).approve(contract, ethers.constants.MaxUint256);
    const approveNft721Tx = await nft721.connect(signer).setApprovalForAll(contract, true);

    await Promise.all([
        approveTokenTx.wait(),
        approveNft721Tx.wait(),
    ]);
}