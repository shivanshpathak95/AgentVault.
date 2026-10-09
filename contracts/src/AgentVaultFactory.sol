// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {AgentVault} from "./AgentVault.sol";

/// @title AgentVaultFactory
/// @notice Deploys AgentVaults deterministically and keeps an owner → vaults index.
/// @dev The index exists so the frontend can find a returning operator's vaults by
///      reading one contract, with no indexer or subgraph in the stack. For a
///      5-day build that is the difference between working and not.
///
///      The factory holds no funds and has no authority over any vault it
///      deploys: ownership is set in the vault's constructor and the factory
///      keeps no privileged role.
contract AgentVaultFactory {
    /// @notice USDC ERC-20 interface address every vault from this factory uses.
    address public immutable USDC;

    mapping(address owner => address[] vaults) private _vaultsOf;

    event VaultCreated(address indexed owner, address indexed vault, bytes32 salt);

    error ZeroAddress();

    constructor(address usdc_) {
        if (usdc_ == address(0)) revert ZeroAddress();
        USDC = usdc_;
    }

    /// @notice Deploy a vault owned by `owner_` at a deterministic address.
    /// @param owner_ The human operator. Becomes the vault's root authority.
    /// @param salt   Caller-chosen; lets one owner hold several vaults.
    function createVault(address owner_, bytes32 salt) external returns (address vault) {
        if (owner_ == address(0)) revert ZeroAddress();

        // Bind the salt to the owner so one caller cannot grief another by
        // front-running their chosen salt at the same address.
        bytes32 scopedSalt = keccak256(abi.encodePacked(owner_, salt));

        vault = address(new AgentVault{salt: scopedSalt}(owner_, USDC));

        _vaultsOf[owner_].push(vault);

        // The event must follow the deployment because the address is its
        // subject. The "external call" is a CREATE2 of a known, in-repo contract
        // whose constructor only writes its own storage — it cannot re-enter.
        // forge-lint: disable-next-line(reentrancy-events)
        emit VaultCreated(owner_, vault, salt);
    }

    /// @notice Address `createVault` would produce, without deploying.
    function predictVaultAddress(address owner_, bytes32 salt) external view returns (address) {
        bytes32 scopedSalt = keccak256(abi.encodePacked(owner_, salt));
        // bytes.concat, not abi.encodePacked: this must be the exact byte string
        // CREATE2 hashes (initcode followed by ABI-encoded constructor args), and
        // concat says that unambiguously for two dynamic operands.
        bytes32 initCodeHash =
            keccak256(bytes.concat(type(AgentVault).creationCode, abi.encode(owner_, USDC)));
        return address(
            uint160(
                uint256(
                    keccak256(
                        abi.encodePacked(bytes1(0xff), address(this), scopedSalt, initCodeHash)
                    )
                )
            )
        );
    }

    function vaultsOf(address owner_) external view returns (address[] memory) {
        return _vaultsOf[owner_];
    }

    function vaultCountOf(address owner_) external view returns (uint256) {
        return _vaultsOf[owner_].length;
    }
}
