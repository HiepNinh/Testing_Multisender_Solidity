import { Contract, Signer } from "ethers";
import { ethers, upgrades, network } from "hardhat";
import { BigNumber } from "@ethersproject/bignumber";
import _ from "lodash";
import EthersAdapter from '@gnosis.pm/safe-ethers-lib'; 
import Safe, { SafeFactory, SafeAccountConfig, ContractNetworksConfig } from '@gnosis.pm/safe-core-sdk';
import { SafeTransactionDataPartial } from '@gnosis.pm/safe-core-sdk-types';
import chai from "chai";
import MerkleTree from "merkletreejs";
import keccak256 from "keccak256";
import { BasicERC20, BasicERC721 } from "../../typechain";
import { setupAddress, mintForReceiver, approveForAll } from '../utils/account';
import { buildDummyNativeCoin, buildDummyERC20, buildDummyNFT } from "../utils/dummyData";
import { getContractNetworks, getEthersAdapter, signOffline, addingSignature } from "../utils/safeGnosis";
import { buildMerkleTree, getHash } from "../utils/merkleTree";
import { buildCalldata } from "../utils/calldata";
import MULTISENDER_ABI from "../../artifacts/contracts/Multisender.sol/Multisender.json";

const expect = chai.expect;
const DELAY_IN_HOUR = 3600;

let deployer: Signer;
let admin1: Signer;
let admin2: Signer;
let user1: Signer;
let user2: Signer;
let user3: Signer;
let user4: Signer;
let user5: Signer;
let rest: Signer[];
let DOMAIN_SEPARATOR: any;
let multisenderProxy: Contract;
let token: BasicERC20;
let nft721: BasicERC721;
let proxyTimelockAddress: string;
let proxyAdminContractAdress: string;
let safeAddress: string;
let contractNetworks: ContractNetworksConfig;
let proxy: string;
let dropingNativeCoin: any;
let dropingToken: any;
let dropingNft: any;


describe("Multisender integartion test", function () {
    this.timeout(1000000);

    before(async () => {
        // Simulate mining every 100 milisecond
        await ethers.provider.send("evm_setIntervalMining", [100]);

        // Setup Addresses
        [deployer, admin1, admin2, user1, user2, user3, user4, user5, ...rest] = await setupAddress();
        
        // Deploy assets contract
        const BasicERC20Factory = await ethers.getContractFactory("BasicERC20");
        token = await BasicERC20Factory.deploy("Oaxis Token", "OAX");
        const BasicERC721Factory = await ethers.getContractFactory("BasicERC721");
        nft721 = await BasicERC721Factory.deploy("CrytosSlap", "CSL");

        // Initialize assets for deployer
        dropingNativeCoin = await buildDummyNativeCoin(user1, user2, user3, user4, user5);
        dropingToken = await buildDummyERC20(user1, user2, user3, user4, user5);
        dropingNft = await buildDummyNFT(user1, user2, user3, user4, user5);
        await mintForReceiver(token, nft721, dropingToken, dropingNft, deployer, await deployer.getAddress());

        // Setup Gnosis Safe

        // Setup Contract Network for Gnosis Safe on current chainId
        const { chainId } = await ethers.provider.getNetwork();
        contractNetworks = await getContractNetworks(chainId, deployer);

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
        safeAddress = safeSdk.getAddress();

        // deploy OwnedTimelockController
        const OwnedTimeLockFactory = await ethers.getContractFactory("OwnedTimelockController")
        const adminTimelock = await OwnedTimeLockFactory.deploy(
            BigNumber.from(DELAY_IN_HOUR),
            [safeAddress],
            [safeAddress]
        );
        proxyTimelockAddress = adminTimelock.address;

        // deploy multisender
        const MultiSenderFactory = await ethers.getContractFactory("Multisender");
        multisenderProxy = await upgrades.deployProxy(MultiSenderFactory, [
            "Multisender",
            "1.0.0",
            BigNumber.from(Date.now()),
            BigNumber.from(DELAY_IN_HOUR),
            [safeAddress],
            [safeAddress]
        ], {
            initializer: 'initialize',
        });
        proxy = multisenderProxy.address;

         // Store ProxyAdmin contract's address
         proxyAdminContractAdress = (await upgrades.admin.getInstance()).address;

         // Transfer ownership to Gnosis
         await upgrades.admin.transferProxyAdminOwnership(proxyTimelockAddress);

         DOMAIN_SEPARATOR = await MultiSenderFactory.attach(proxy).domainSeparator();
         await approveForAll(token, nft721, proxy, deployer);
    });

    it("it should be PROPOSE initializing request successfully", async () => {
       const tree = buildMerkleTree([token.address, nft721.address], DOMAIN_SEPARATOR) as MerkleTree;
       
        const coinAmount = _.sumBy(_.values(dropingNativeCoin));
        const tokenAmount = _.sumBy(_.values(dropingToken));
        const token721Ids = _.concat(..._.values(dropingNft));

        const seedCalldata = await buildCalldata(MULTISENDER_ABI.abi, "seedNewAllocations", [
            tree.getHexRoot(),
            await deployer.getAddress(),
            token.address,
            nft721.address,
            ethers.utils.parseEther(coinAmount.toString()),
            tokenAmount,
            token721Ids
        ]);

        // Note:
        // The admin will create Transaction Proposal
        // Transaction can be list to the queue as long as it reach required confirmation (2) 
        // After insert to queue, it need to be wait for a specific of block number get confirmed to be executed
        const scheduleCalldata = await buildCalldata(MULTISENDER_ABI.abi, "schedule", [
            proxy, 
            ethers.utils.parseEther(coinAmount.toString()),
            seedCalldata,
            ethers.utils.formatBytes32String(""),
            ethers.utils.formatBytes32String(""),
            BigNumber.from(DELAY_IN_HOUR)
        ]);
        // admin1 create and sign offline
        const transaction: SafeTransactionDataPartial = {
            to: proxy,
            value: '0',
            data: scheduleCalldata
        }
        const admin1EthAdapter: EthersAdapter = await getEthersAdapter(admin1);
        const safeSdk1 = await Safe.create({ ethAdapter: admin1EthAdapter, safeAddress, contractNetworks })
        const safeTransaction = await safeSdk1.createTransaction(transaction); 
        // Admin1 sign offline the transaction
        await signOffline(safeSdk1, safeTransaction);

        // Admin2 sign offline and execute
        const admin2EthAdapter = await getEthersAdapter(admin2);
        const safeSdk2 = await Safe.create({ ethAdapter: admin2EthAdapter, safeAddress, contractNetworks })
        const safeTransaction2 = await safeSdk2.createTransaction(transaction);
        await signOffline(safeSdk2, safeTransaction2);
        const signature2 = safeTransaction2.signatures.get((await admin2.getAddress()).toLocaleLowerCase());

        // Admin1 run the transactions
        await addingSignature(safeTransaction, signature2?.signer, signature2?.data)
        const executeTxResponse = await safeSdk1.executeTransaction(safeTransaction)
        await executeTxResponse.transactionResponse?.wait(45)

        expect(await ethers.provider.getBalance(proxy)).to.equal(0);
        expect(await token.balanceOf(proxy)).to.equal(0);
        expect(await nft721.balanceOf(proxy)).to.equal(0);
        
        const timlockId = ethers.utils.keccak256(
            ethers.utils.defaultAbiCoder.encode(
                ["address", "uint256", "bytes", "bytes32", "bytes32"],
                [
                    proxy, 
                    ethers.utils.parseEther(coinAmount.toString()),
                    seedCalldata,
                    ethers.utils.formatBytes32String(""),
                    ethers.utils.formatBytes32String("")
                ]
            )
        );
        const MultiSenderFactory = await ethers.getContractFactory("Multisender");
        expect(await MultiSenderFactory.attach(proxy).isOperationPending(timlockId)).to.equal(true);
        expect(await MultiSenderFactory.attach(proxy).isOperationReady(timlockId)).to.equal(false);
    })
    it("It should be REVERT when DELAY_TIME has NOT expired yet", async () => {
        const tree = buildMerkleTree([token.address, nft721.address], DOMAIN_SEPARATOR) as MerkleTree;

        const coinAmount = _.sumBy(_.values(dropingNativeCoin));
        const tokenAmount = _.sumBy(_.values(dropingToken));
        const token721Ids = _.concat(_.values(dropingNft));

        const seedCalldata = await buildCalldata(MULTISENDER_ABI.abi, "seedNewAllocations", [
            tree.getHexRoot(),
            await deployer.getAddress(),
            token.address,
            nft721.address,
            ethers.utils.parseEther(coinAmount.toString()),
            tokenAmount,
            token721Ids
        ]);

        // Deployer deposit fund to Gnosis Safe
        const tx = await deployer.sendTransaction({
            to: safeAddress,
            value: ethers.utils.parseEther(coinAmount.toString())
        });
        await tx.wait();

        const execCalldata = await buildCalldata(MULTISENDER_ABI.abi, "execute", [
            proxy, 
            ethers.utils.parseEther(coinAmount.toString()),
            seedCalldata,
            ethers.utils.formatBytes32String(""),
            ethers.utils.formatBytes32String(""),
        ]);

        // Owner1 create and sign offline
        const transaction: SafeTransactionDataPartial = {
            to: proxy,
            value: ethers.utils.parseEther(coinAmount.toString()).toString(),
            data: execCalldata
        }
        const admin1EthAdapter: EthersAdapter = await getEthersAdapter(admin1);
        const safeSdk1 = await Safe.create({ ethAdapter: admin1EthAdapter, safeAddress, contractNetworks })
        const safeTransaction = await safeSdk1.createTransaction(transaction); 
        // Owner1 sign online the transaction
        await signOffline(safeSdk1, safeTransaction);

        // Admin2 sign offline and execute
        const admin2EthAdapter = await getEthersAdapter(admin2);
        const safeSdk2 = await Safe.create({ ethAdapter: admin2EthAdapter, safeAddress, contractNetworks })
        const safeTransaction2 = await safeSdk2.createTransaction(transaction);
        await signOffline(safeSdk2, safeTransaction2);
        const signature2 = safeTransaction2.signatures.get((await admin2.getAddress()).toLocaleLowerCase());

        await addingSignature(safeTransaction, signature2?.signer, signature2?.data)
        await expect(safeSdk1.executeTransaction(safeTransaction)).to.be.revertedWith('GS013');
    })
    it("It should be EXEC after DELAY_TIME has expired", async () => {
        await network.provider.send("evm_increaseTime", [DELAY_IN_HOUR]);
        await network.provider.send("evm_mine");

        const tree = buildMerkleTree([token.address, nft721.address], DOMAIN_SEPARATOR) as MerkleTree;
       
        const coinAmount = _.sumBy(_.values(dropingNativeCoin));
        const tokenAmount = _.sumBy(_.values(dropingToken));
        const token721Ids = _.concat(..._.values(dropingNft));

        const seedCalldata = await buildCalldata(MULTISENDER_ABI.abi, "seedNewAllocations", [
            tree.getHexRoot(),
            await deployer.getAddress(),
            token.address,
            nft721.address,
            ethers.utils.parseEther(coinAmount.toString()),
            tokenAmount,
            token721Ids
        ]);

        // Deployer deposit fund to Gnosis Safe
        const tx = await deployer.sendTransaction({
            to: safeAddress,
            value: ethers.utils.parseEther(coinAmount.toString())
        });
        await tx.wait();

        const execCalldata = await buildCalldata(MULTISENDER_ABI.abi, "execute", [
            proxy, 
            ethers.utils.parseEther(coinAmount.toString()),
            seedCalldata,
            ethers.utils.formatBytes32String(""),
            ethers.utils.formatBytes32String(""),
        ]);

        // Owner1 create and sign offline
        const transaction: SafeTransactionDataPartial = {
            to: proxy,
            value: ethers.utils.parseEther(coinAmount.toString()).toString(),
            data: execCalldata
        }
        const admin1EthAdapter: EthersAdapter = await getEthersAdapter(admin1);
        const safeSdk1 = await Safe.create({ ethAdapter: admin1EthAdapter, safeAddress, contractNetworks })
        const safeTransaction = await safeSdk1.createTransaction(transaction); 
        // Owner1 sign online the transaction
        await signOffline(safeSdk1, safeTransaction);

        // Admin2 sign offline and execute
        const admin2EthAdapter = await getEthersAdapter(admin2);
        const safeSdk2 = await Safe.create({ ethAdapter: admin2EthAdapter, safeAddress, contractNetworks })
        const safeTransaction2 = await safeSdk2.createTransaction(transaction);
        await signOffline(safeSdk2, safeTransaction2);
        const signature2 = safeTransaction2.signatures.get((await admin2.getAddress()).toLocaleLowerCase());

        await addingSignature(safeTransaction, signature2?.signer, signature2?.data)
        const executeTxResponse = await safeSdk1.executeTransaction(safeTransaction)
        await executeTxResponse.transactionResponse?.wait(45)

        expect(await ethers.provider.getBalance(proxy)).to.equal(ethers.utils.parseEther(coinAmount.toString()));
        expect(await token.balanceOf(proxy)).to.equal(tokenAmount);
        expect(await nft721.balanceOf(proxy)).to.equal(token721Ids.length);
    })

    it("It should be PROPOSE a drop NATIVE COINS request successfully", async () => {
        const receivers = _.keys(dropingNativeCoin)
        const amounts = _.map(_.values(dropingNativeCoin), item => ethers.utils.parseEther(item.toString()));

        const dropCalldata = await buildCalldata(MULTISENDER_ABI.abi, "dropNativeCoin", [
            receivers,
            amounts
        ]);

        const scheduleCalldata = await buildCalldata(MULTISENDER_ABI.abi, "schedule", [
            proxy, 
            '0',
            dropCalldata,
            ethers.utils.formatBytes32String(""),
            ethers.utils.formatBytes32String(""),
            BigNumber.from(DELAY_IN_HOUR)
        ]);

        // admin1 create and sign offline
        const transaction: SafeTransactionDataPartial = {
            to: proxy,
            value: '0',
            data: scheduleCalldata
        }
        const admin1EthAdapter: EthersAdapter = await getEthersAdapter(admin1);
        const safeSdk1 = await Safe.create({ ethAdapter: admin1EthAdapter, safeAddress, contractNetworks })
        const safeTransaction = await safeSdk1.createTransaction(transaction); 
        // Admin1 sign offline the transaction
        await signOffline(safeSdk1, safeTransaction);

        // Admin2 sign offline and execute
        const admin2EthAdapter = await getEthersAdapter(admin2);
        const safeSdk2 = await Safe.create({ ethAdapter: admin2EthAdapter, safeAddress, contractNetworks })
        const safeTransaction2 = await safeSdk2.createTransaction(transaction);
        await signOffline(safeSdk2, safeTransaction2);
        const signature2 = safeTransaction2.signatures.get((await admin2.getAddress()).toLocaleLowerCase());

        // Admin1 run the transactions
        await addingSignature(safeTransaction, signature2?.signer, signature2?.data)
        const executeTxResponse = await safeSdk1.executeTransaction(safeTransaction)

        expect(await executeTxResponse.transactionResponse?.wait(45)).to.changeEtherBalance(
            [user1, user2, user3, user4, user5], 
            [0, 0, 0, 0, 0]
        )

        const timlockId = ethers.utils.keccak256(
            ethers.utils.defaultAbiCoder.encode(
                ["address", "uint256", "bytes", "bytes32", "bytes32"],
                [
                    proxy, 
                    0,
                    dropCalldata,
                    ethers.utils.formatBytes32String(""),
                    ethers.utils.formatBytes32String("")
                ]
            )
        );
        const MultiSenderFactory = await ethers.getContractFactory("Multisender");
        expect(await MultiSenderFactory.attach(proxy).isOperationPending(timlockId)).to.equal(true);
        expect(await MultiSenderFactory.attach(proxy).isOperationReady(timlockId)).to.equal(false);
    })
    it("It should be EXEC drop NATIVE COINS to all receivers successfully", async () => {
        await network.provider.send("evm_increaseTime", [DELAY_IN_HOUR]);
        await network.provider.send("evm_mine");

        const receivers = _.keys(dropingNativeCoin)
        const amounts = _.map(_.values(dropingNativeCoin), item => ethers.utils.parseEther(item.toString()));

        const dropCalldata = await buildCalldata(MULTISENDER_ABI.abi, "dropNativeCoin", [
            receivers,
            amounts
        ]);

        const execCalldata = await buildCalldata(MULTISENDER_ABI.abi, "execute", [
            proxy, 
            '0',
            dropCalldata,
            ethers.utils.formatBytes32String(""),
            ethers.utils.formatBytes32String(""),
        ]);

        // admin1 create and sign offline
        const transaction: SafeTransactionDataPartial = {
            to: proxy,
            value: '0',
            data: execCalldata
        }
        const admin1EthAdapter: EthersAdapter = await getEthersAdapter(admin1);
        const safeSdk1 = await Safe.create({ ethAdapter: admin1EthAdapter, safeAddress, contractNetworks })
        const safeTransaction = await safeSdk1.createTransaction(transaction); 
        // Admin1 sign offline the transaction
        await signOffline(safeSdk1, safeTransaction);

        // Admin2 sign offline and execute
        const admin2EthAdapter = await getEthersAdapter(admin2);
        const safeSdk2 = await Safe.create({ ethAdapter: admin2EthAdapter, safeAddress, contractNetworks })
        const safeTransaction2 = await safeSdk2.createTransaction(transaction);
        await signOffline(safeSdk2, safeTransaction2);
        const signature2 = safeTransaction2.signatures.get((await admin2.getAddress()).toLocaleLowerCase());

        // Admin1 run the transactions
        await addingSignature(safeTransaction, signature2?.signer, signature2?.data)
        const executeTxResponse = await safeSdk1.executeTransaction(safeTransaction)

        expect(await executeTxResponse.transactionResponse?.wait(45)).to.changeEtherBalance(
            [user1, user2, user3, user4, user5], 
            [
                ethers.utils.parseEther(amounts[0].toString()),
                ethers.utils.parseEther(amounts[1].toString()),
                ethers.utils.parseEther(amounts[2].toString()),
                ethers.utils.parseEther(amounts[3].toString()),
                ethers.utils.parseEther(amounts[4].toString())
            ]
        )

        const timlockId = ethers.utils.keccak256(
            ethers.utils.defaultAbiCoder.encode(
                ["address", "uint256", "bytes", "bytes32", "bytes32"],
                [
                    proxy, 
                    0,
                    dropCalldata,
                    ethers.utils.formatBytes32String(""),
                    ethers.utils.formatBytes32String("")
                ]
            )
        );
        const MultiSenderFactory = await ethers.getContractFactory("Multisender");
        expect(await MultiSenderFactory.attach(proxy).isOperationPending(timlockId)).to.equal(false);
        expect(await MultiSenderFactory.attach(proxy).isOperationDone(timlockId)).to.equal(true);
    })

    it("It should be PROPOSE a drop ERC20 TOKEN request successfully", async () => {
        const receivers = _.keys(dropingToken)
        const amounts = _.values(dropingToken)
        const tree = buildMerkleTree([token.address, nft721.address], DOMAIN_SEPARATOR) as MerkleTree
        const leaf = ethers.utils.keccak256(getHash(token.address, DOMAIN_SEPARATOR));

        const dropCalldata = await buildCalldata(MULTISENDER_ABI.abi, "dropToken", [
            receivers,
            token.address,
            amounts,
            tree.getHexProof(leaf)
        ]);

        const scheduleCalldata = await buildCalldata(MULTISENDER_ABI.abi, "schedule", [
            proxy, 
            '0',
            dropCalldata,
            ethers.utils.formatBytes32String(""),
            ethers.utils.formatBytes32String(""),
            BigNumber.from(DELAY_IN_HOUR)
        ]);

        // admin1 create and sign offline
        const transaction: SafeTransactionDataPartial = {
            to: proxy,
            value: '0',
            data: scheduleCalldata
        }
        const admin1EthAdapter: EthersAdapter = await getEthersAdapter(admin1);
        const safeSdk1 = await Safe.create({ ethAdapter: admin1EthAdapter, safeAddress, contractNetworks })
        const safeTransaction = await safeSdk1.createTransaction(transaction); 
        // Admin1 sign offline the transaction
        await signOffline(safeSdk1, safeTransaction);

        // Admin2 sign offline and execute
        const admin2EthAdapter = await getEthersAdapter(admin2);
        const safeSdk2 = await Safe.create({ ethAdapter: admin2EthAdapter, safeAddress, contractNetworks })
        const safeTransaction2 = await safeSdk2.createTransaction(transaction);
        await signOffline(safeSdk2, safeTransaction2);
        const signature2 = safeTransaction2.signatures.get((await admin2.getAddress()).toLocaleLowerCase());

        // Admin1 run the transactions
        await addingSignature(safeTransaction, signature2?.signer, signature2?.data)
        const executeTxResponse = await safeSdk1.executeTransaction(safeTransaction)
        await executeTxResponse.transactionResponse?.wait(45)

        expect(await token.balanceOf(await user1.getAddress())).to.equal(0)
        expect(await token.balanceOf(await user2.getAddress())).to.equal(0)
        expect(await token.balanceOf(await user3.getAddress())).to.equal(0)
        expect(await token.balanceOf(await user4.getAddress())).to.equal(0)
        expect(await token.balanceOf(await user5.getAddress())).to.equal(0)

        const timlockId = ethers.utils.keccak256(
            ethers.utils.defaultAbiCoder.encode(
                ["address", "uint256", "bytes", "bytes32", "bytes32"],
                [
                    proxy, 
                    0,
                    dropCalldata,
                    ethers.utils.formatBytes32String(""),
                    ethers.utils.formatBytes32String("")
                ]
            )
        );
        const MultiSenderFactory = await ethers.getContractFactory("Multisender");
        expect(await MultiSenderFactory.attach(proxy).isOperationPending(timlockId)).to.equal(true);
        expect(await MultiSenderFactory.attach(proxy).isOperationReady(timlockId)).to.equal(false);
    })
    it("It should be EXEC drop TOKEN to all receivers successfully", async () => {
        await network.provider.send("evm_increaseTime", [DELAY_IN_HOUR]);
        await network.provider.send("evm_mine");

        const receivers = _.keys(dropingToken)
        const amounts = _.values(dropingToken)
        const tree = buildMerkleTree([token.address, nft721.address], DOMAIN_SEPARATOR) as MerkleTree
        const leaf = ethers.utils.keccak256(getHash(token.address, DOMAIN_SEPARATOR));

        const dropCalldata = await buildCalldata(MULTISENDER_ABI.abi, "dropToken", [
            receivers,
            token.address,
            amounts,
            tree.getHexProof(leaf)
        ]);

        const execCalldata = await buildCalldata(MULTISENDER_ABI.abi, "execute", [
            proxy, 
            '0',
            dropCalldata,
            ethers.utils.formatBytes32String(""),
            ethers.utils.formatBytes32String(""),
        ]);

        // admin1 create and sign offline
        const transaction: SafeTransactionDataPartial = {
            to: proxy,
            value: '0',
            data: execCalldata
        }
        const admin1EthAdapter: EthersAdapter = await getEthersAdapter(admin1);
        const safeSdk1 = await Safe.create({ ethAdapter: admin1EthAdapter, safeAddress, contractNetworks })
        const safeTransaction = await safeSdk1.createTransaction(transaction); 
        // Admin1 sign offline the transaction
        await signOffline(safeSdk1, safeTransaction);

        // Admin2 sign offline and execute
        const admin2EthAdapter = await getEthersAdapter(admin2);
        const safeSdk2 = await Safe.create({ ethAdapter: admin2EthAdapter, safeAddress, contractNetworks })
        const safeTransaction2 = await safeSdk2.createTransaction(transaction);
        await signOffline(safeSdk2, safeTransaction2);
        const signature2 = safeTransaction2.signatures.get((await admin2.getAddress()).toLocaleLowerCase());

        // Admin1 run the transactions
        await addingSignature(safeTransaction, signature2?.signer, signature2?.data)
        const executeTxResponse = await safeSdk1.executeTransaction(safeTransaction)
        await executeTxResponse.transactionResponse?.wait(45)

        expect(await token.balanceOf(await user1.getAddress())).to.equal(amounts[0])
        expect(await token.balanceOf(await user2.getAddress())).to.equal(amounts[1])
        expect(await token.balanceOf(await user3.getAddress())).to.equal(amounts[2])
        expect(await token.balanceOf(await user4.getAddress())).to.equal(amounts[3])
        expect(await token.balanceOf(await user5.getAddress())).to.equal(amounts[4])

        const timlockId = ethers.utils.keccak256(
            ethers.utils.defaultAbiCoder.encode(
                ["address", "uint256", "bytes", "bytes32", "bytes32"],
                [
                    proxy, 
                    0,
                    dropCalldata,
                    ethers.utils.formatBytes32String(""),
                    ethers.utils.formatBytes32String("")
                ]
            )
        );
        const MultiSenderFactory = await ethers.getContractFactory("Multisender");
        expect(await MultiSenderFactory.attach(proxy).isOperationPending(timlockId)).to.equal(false);
        expect(await MultiSenderFactory.attach(proxy).isOperationDone(timlockId)).to.equal(true);
    })

    it("It should be PROPOSE a drop ERC721 request successfully", async () => {
        const receivers = _.keys(dropingNft)
        const tokenIds = _.values(dropingNft)
        const tree = buildMerkleTree([token.address, nft721.address], DOMAIN_SEPARATOR) as MerkleTree
        const leaf = ethers.utils.keccak256(getHash(nft721.address, DOMAIN_SEPARATOR));

        const dropCalldata = await buildCalldata(MULTISENDER_ABI.abi, "dropNFT721", [
            receivers,
            nft721.address,
            tokenIds,
            tree.getHexProof(leaf)
        ]);

        const scheduleCalldata = await buildCalldata(MULTISENDER_ABI.abi, "schedule", [
            proxy, 
            '0',
            dropCalldata,
            ethers.utils.formatBytes32String(""),
            ethers.utils.formatBytes32String(""),
            BigNumber.from(DELAY_IN_HOUR)
        ]);

        // admin1 create and sign offline
        const transaction: SafeTransactionDataPartial = {
            to: proxy,
            value: '0',
            data: scheduleCalldata
        }
        const admin1EthAdapter: EthersAdapter = await getEthersAdapter(admin1);
        const safeSdk1 = await Safe.create({ ethAdapter: admin1EthAdapter, safeAddress, contractNetworks })
        const safeTransaction = await safeSdk1.createTransaction(transaction); 
        // Admin1 sign offline the transaction
        await signOffline(safeSdk1, safeTransaction);

        // Admin2 sign offline and execute
        const admin2EthAdapter = await getEthersAdapter(admin2);
        const safeSdk2 = await Safe.create({ ethAdapter: admin2EthAdapter, safeAddress, contractNetworks })
        const safeTransaction2 = await safeSdk2.createTransaction(transaction);
        await signOffline(safeSdk2, safeTransaction2);
        const signature2 = safeTransaction2.signatures.get((await admin2.getAddress()).toLocaleLowerCase());

        // Admin1 run the transactions
        await addingSignature(safeTransaction, signature2?.signer, signature2?.data)
        const executeTxResponse = await safeSdk1.executeTransaction(safeTransaction)
        await executeTxResponse.transactionResponse?.wait(45)

        expect(await nft721.balanceOf(await user1.getAddress())).to.equal(0)
        expect(await nft721.balanceOf(await user2.getAddress())).to.equal(0)
        expect(await nft721.balanceOf(await user3.getAddress())).to.equal(0)
        expect(await nft721.balanceOf(await user4.getAddress())).to.equal(0)
        expect(await nft721.balanceOf(await user5.getAddress())).to.equal(0)

        const timlockId = ethers.utils.keccak256(
            ethers.utils.defaultAbiCoder.encode(
                ["address", "uint256", "bytes", "bytes32", "bytes32"],
                [
                    proxy, 
                    0,
                    dropCalldata,
                    ethers.utils.formatBytes32String(""),
                    ethers.utils.formatBytes32String("")
                ]
            )
        );
        const MultiSenderFactory = await ethers.getContractFactory("Multisender");
        expect(await MultiSenderFactory.attach(proxy).isOperationPending(timlockId)).to.equal(true);
        expect(await MultiSenderFactory.attach(proxy).isOperationReady(timlockId)).to.equal(false);
    })
    it("It should be EXEC drop ERC721 to all receivers successfully", async () => {
        await network.provider.send("evm_increaseTime", [DELAY_IN_HOUR]);
        await network.provider.send("evm_mine");

        const receivers = _.keys(dropingNft)
        const tokenIds = _.values(dropingNft)
        const tree = buildMerkleTree([token.address, nft721.address], DOMAIN_SEPARATOR) as MerkleTree
        const leaf = ethers.utils.keccak256(getHash(nft721.address, DOMAIN_SEPARATOR));

        const dropCalldata = await buildCalldata(MULTISENDER_ABI.abi, "dropNFT721", [
            receivers,
            nft721.address,
            tokenIds,
            tree.getHexProof(leaf)
        ]);

        const execCalldata = await buildCalldata(MULTISENDER_ABI.abi, "execute", [
            proxy, 
            '0',
            dropCalldata,
            ethers.utils.formatBytes32String(""),
            ethers.utils.formatBytes32String(""),
        ]);

        // admin1 create and sign offline
        const transaction: SafeTransactionDataPartial = {
            to: proxy,
            value: '0',
            data: execCalldata
        }
        const admin1EthAdapter: EthersAdapter = await getEthersAdapter(admin1);
        const safeSdk1 = await Safe.create({ ethAdapter: admin1EthAdapter, safeAddress, contractNetworks })
        const safeTransaction = await safeSdk1.createTransaction(transaction); 
        // Admin1 sign offline the transaction
        await signOffline(safeSdk1, safeTransaction);

        // Admin2 sign offline and execute
        const admin2EthAdapter = await getEthersAdapter(admin2);
        const safeSdk2 = await Safe.create({ ethAdapter: admin2EthAdapter, safeAddress, contractNetworks })
        const safeTransaction2 = await safeSdk2.createTransaction(transaction);
        await signOffline(safeSdk2, safeTransaction2);
        const signature2 = safeTransaction2.signatures.get((await admin2.getAddress()).toLocaleLowerCase());

        // Admin1 run the transactions
        await addingSignature(safeTransaction, signature2?.signer, signature2?.data)
        const executeTxResponse = await safeSdk1.executeTransaction(safeTransaction)
        await executeTxResponse.transactionResponse?.wait(45)

        expect(await nft721.balanceOf(await user1.getAddress())).to.equal(tokenIds[0].length)
        expect(await nft721.balanceOf(await user2.getAddress())).to.equal(tokenIds[1].length)
        expect(await nft721.balanceOf(await user3.getAddress())).to.equal(tokenIds[2].length)
        expect(await nft721.balanceOf(await user4.getAddress())).to.equal(tokenIds[3].length)
        expect(await nft721.balanceOf(await user5.getAddress())).to.equal(tokenIds[4].length)

        const timlockId = ethers.utils.keccak256(
            ethers.utils.defaultAbiCoder.encode(
                ["address", "uint256", "bytes", "bytes32", "bytes32"],
                [
                    proxy, 
                    0,
                    dropCalldata,
                    ethers.utils.formatBytes32String(""),
                    ethers.utils.formatBytes32String("")
                ]
            )
        );
        const MultiSenderFactory = await ethers.getContractFactory("Multisender");
        expect(await MultiSenderFactory.attach(proxy).isOperationPending(timlockId)).to.equal(false);
        expect(await MultiSenderFactory.attach(proxy).isOperationDone(timlockId)).to.equal(true);
    })
})