
import { ethers } from "hardhat";

export const buildCalldata = async (
    abi: any,
    functionCall: string,
    params: any[]
): Promise<string> => {
    const itf = new ethers.utils.Interface(abi);
    return itf.encodeFunctionData(functionCall, [
        ...params
    ]);
}