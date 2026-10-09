// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Script, console2} from "forge-std/Script.sol";
import {AgentVaultFactory} from "../src/AgentVaultFactory.sol";

/// @notice Deploys AgentVaultFactory. Fully env-driven — no address, chain id or
///         RPC endpoint is hardcoded anywhere in this repo.
///
/// Usage:
///   forge script script/Deploy.s.sol --rpc-url $ARC_RPC_URL --broadcast --account deployer
///
/// Required env:
///   EXPECTED_CHAIN_ID   asserted against block.chainid before anything deploys
///   USDC_ADDRESS        the Arc USDC ERC-20 interface (6 decimals)
contract Deploy is Script {
    function run() external returns (AgentVaultFactory factory) {
        uint256 expectedChainId = vm.envUint("EXPECTED_CHAIN_ID");
        address usdc = vm.envAddress("USDC_ADDRESS");

        // Arc mainnet (5042) and testnet (5042002) differ by three characters.
        // A stale RPC URL in a shell must not be able to put real money on the
        // wrong network. Fail before broadcasting, not after. (Threat T-13.)
        require(
            block.chainid == expectedChainId,
            "Deploy: chainid mismatch - check ARC_RPC_URL against EXPECTED_CHAIN_ID"
        );
        require(usdc != address(0), "Deploy: USDC_ADDRESS not set");
        require(usdc.code.length > 0, "Deploy: USDC_ADDRESS has no code on this chain");

        vm.startBroadcast();
        factory = new AgentVaultFactory(usdc);
        vm.stopBroadcast();

        console2.log("chainId           ", block.chainid);
        console2.log("USDC              ", usdc);
        console2.log("AgentVaultFactory ", address(factory));
        console2.log("");
        console2.log("Set NEXT_PUBLIC_VAULT_FACTORY_ADDRESS to the factory address above.");
    }
}
