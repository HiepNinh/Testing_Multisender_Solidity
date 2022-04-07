// SPDX-License-Identifier: MIT
pragma solidity ^0.8.9;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC721/IERC721Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC721/utils/ERC721HolderUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/IERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/security/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/cryptography/ECDSAUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/cryptography/MerkleProofUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/governance/TimelockControllerUpgradeable.sol";

contract Multisender is 
    Initializable,
    TimelockControllerUpgradeable,
    ReentrancyGuardUpgradeable,
    ERC721HolderUpgradeable
{
    using SafeERC20Upgradeable for IERC20Upgradeable;

    event InitialAllocation(bytes32 merkleRoot, uint256 totalCoin, address erc20, uint256 totalToken, address erc721, uint256[] erc721Ids);
    event DropNativeCoin(address[] receivers, uint256[] amounts);
    event DropToken(address[] receivers, address tokenAddress, uint256[] amounts);
    event DropNFT721(address[] receivers, address nftAddress, uint256[][] tokenIdsPacks);
    event MultiSendPaused(bool isPaused);

    string private constant DOMAIN = "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract, bytes32 salt)";
    bytes32 private constant DOMAIN_TYPE_HASH = keccak256(abi.encodePacked(DOMAIN));
    bytes32 public domainSeparator;

    bytes32 internal _kycAssetMerkleRoot;
    bool internal _isPaused;

    modifier selfExecute {
        require(_msgSender() == address(this), "Caller must be timelock");
        _;
    }

    function initialize(
        string memory name, 
        string memory version, 
        uint256 salt,
        uint256 minDelay,
        address[] memory proposers,
        address[] memory executors
    ) initializer public {
        __TimelockController_init(minDelay, proposers, executors);
        __ReentrancyGuard_init();
        __ERC721Holder_init();

        uint256 chainId;
        assembly {
            chainId := chainid()
        }
        domainSeparator = keccak256(abi.encode(
            DOMAIN_TYPE_HASH,
            keccak256(abi.encodePacked(name)),
            keccak256(abi.encodePacked(version)),
            keccak256(abi.encodePacked(chainId)),
            keccak256(abi.encodePacked(address(this))),
            keccak256(abi.encodePacked(salt))
        ));

        revokeRole(TIMELOCK_ADMIN_ROLE, _msgSender());
    }

    function seedNewAllocations(
        bytes32 merkleRoot, 
        address funder,
        address erc20Address,
        address erc721Address,
        uint256 totalCoin,
        uint256 totalToken,
        uint256[] memory erc721Ids
    ) external payable selfExecute {
        _kycAssetMerkleRoot = merkleRoot;

        if(totalCoin > 0) {
            require(msg.value >= totalCoin, "Not enough coin transfered");
        }

        if(erc20Address != address(0)) { // Transfer ERC20 to contract
            require(totalToken > 0, "Allocation is invalid");
            IERC20Upgradeable(erc20Address).safeTransferFrom(funder, address(this), totalToken);
        }

        if(erc721Address != address(0)) { // Transfer NFTs(ERC721) to contract
            require(erc721Ids.length > 0, "List of ERC721 tokens is empty");
            for(uint256 i = 0; i < erc721Ids.length; i++) {
                IERC721Upgradeable(erc721Address).safeTransferFrom(funder, address(this), erc721Ids[i]);
            }
        }

        emit InitialAllocation(_kycAssetMerkleRoot, totalCoin, erc20Address, totalToken, erc721Address, erc721Ids);
    }

    function dropNativeCoin(
        address[] memory receivers, 
        uint256[] memory amounts
    ) public nonReentrant selfExecute {
        require(receivers.length == amounts.length, "Invalid length of amounts");

        uint256 total = 0;
        for(uint256 j = 0; j < amounts.length; j++) {
            total = total + amounts[j];
        }
        require(address(this).balance >= total, "Not enough balance");

        for (uint256 i = 0; i < receivers.length; i++) {
            _disburseNativeCoin(receivers[i], amounts[i]);
        }

        emit DropNativeCoin(receivers, amounts);
    }

    function dropToken(
        address[] memory receivers, 
        address tokenAddress,
        uint256[] memory amounts,
        bytes32[] memory merkleProof
    ) public nonReentrant selfExecute {
        require(_verifyMerkleTree(_getHash(tokenAddress), merkleProof), "Incorrect merkle proof");
        require(receivers.length == amounts.length, "Invalid length of amounts");

        uint256 total = 0;
        for(uint256 j = 0; j < amounts.length; j++) {
            total = total + amounts[j];
        }
        require(IERC20Upgradeable(tokenAddress).balanceOf(address(this)) >= total, "Not enough balance");

        for (uint256 i = 0; i < receivers.length; i++) {
            _disburseToken(receivers[i], tokenAddress, amounts[i]);
        }

        emit DropToken(receivers, tokenAddress, amounts);
    }

    function dropNFT721(
        address[] memory receivers, 
        address nftAddress,
        uint256[][] memory tokenIdsPacks,
        bytes32[] memory merkleProof
    ) public nonReentrant selfExecute {
        require(_verifyMerkleTree(_getHash(nftAddress), merkleProof), "Incorrect merkle proof");
        require(receivers.length == tokenIdsPacks.length, "Invalid length of amounts");

        for (uint256 i = 0; i < receivers.length; i++) {
            _disburseNFT721(receivers[i], nftAddress, tokenIdsPacks[i]);
        }

        emit DropNFT721(receivers, nftAddress, tokenIdsPacks);
    }

    function _verifyMerkleTree(
        bytes32 leaf,
        bytes32[] memory merkleProof
    ) 
        private
        view
        returns (bool valid)
    {
        return MerkleProofUpgradeable.verify(merkleProof, _kycAssetMerkleRoot, keccak256(abi.encodePacked(leaf)));
    }

    function _getHash(
        address contractAddress
    ) private view returns (bytes32) {
        return keccak256(abi.encodePacked(
            "\x19\x01",
            domainSeparator,
            keccak256(abi.encode(
                contractAddress
            ))
        ));
    } 

    function _disburseNativeCoin(
        address receiver, 
        uint256 amount
    ) private {
        require(receiver != address(0), "Invalid address");

        if(amount > 0) {
            payable(receiver).transfer(amount);
        } else {
            revert("No balance would be transferred");
        }
    }

    function _disburseToken(
        address receiver, 
        address tokenAddress, 
        uint256 amount
    ) private {
        require(receiver != address(0), "Invalid address");

        if(amount > 0) {
            IERC20Upgradeable(tokenAddress).safeTransfer(receiver, amount);
        } else {
            revert("No balance would be transferred");
        }
    }

    function _disburseNFT721(
        address receiver, 
        address nftAddress, 
        uint256[] memory tokenIds
    ) private {
        require(receiver != address(0), "Invalid address");

        if(tokenIds.length > 0) {
            for(uint256 i = 0; i < tokenIds.length; i++) {
                IERC721Upgradeable(nftAddress).safeTransferFrom(address(this), receiver, tokenIds[i]);
            }
        } else {
            revert("No token would be transferred");
        }
    }

    // Use this for emergency withdraw all assets when has any vulnerability or attack from attackers
    function emergencyWithdrawToken(
        address receiver, 
        address tokenAddress
    ) public selfExecute {
        _disburseNativeCoin(receiver, address(this).balance);
        _disburseToken(receiver, tokenAddress, IERC20Upgradeable(tokenAddress).balanceOf(address(this)));
    }

    function emergencyWithdrawNFT721(
        address receiver, 
        address nftAddress, 
        uint256[] memory tokenIds
    ) public selfExecute {
        _disburseNFT721(receiver, nftAddress, tokenIds);
    }

}