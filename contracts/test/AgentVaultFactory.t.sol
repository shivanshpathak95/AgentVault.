// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";
import {AgentVault} from "../src/AgentVault.sol";
import {AgentVaultFactory} from "../src/AgentVaultFactory.sol";
import {MockUSDC} from "./mocks/MockUSDC.sol";

contract AgentVaultFactoryTest is Test {
    AgentVaultFactory internal factory;
    MockUSDC internal usdc;

    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");

    function setUp() public {
        usdc = new MockUSDC();
        factory = new AgentVaultFactory(address(usdc));
    }

    function test_createVault_setsOwnerAndToken() public {
        address vault = factory.createVault(alice, bytes32(0));

        assertEq(AgentVault(vault).owner(), alice, "owner is the human, not the factory");
        assertEq(AgentVault(vault).usdc(), address(usdc));
    }

    /// @dev The frontend shows a vault address before it exists; if this maths is
    ///      wrong it would ask an operator to fund a dead address.
    function testFuzz_predictVaultAddress_matchesDeployment(address owner_, bytes32 salt) public {
        vm.assume(owner_ != address(0));

        address predicted = factory.predictVaultAddress(owner_, salt);
        address actual = factory.createVault(owner_, salt);

        assertEq(actual, predicted, "CREATE2 prediction diverged from deployment");
    }

    function test_saltIsScopedToOwner() public {
        // Same raw salt, different owners => different addresses, so one caller
        // cannot occupy the address another is about to use.
        address a = factory.createVault(alice, bytes32(uint256(7)));
        address b = factory.createVault(bob, bytes32(uint256(7)));
        assertTrue(a != b);
    }

    function test_vaultsOf_indexesByOwner() public {
        address v1 = factory.createVault(alice, bytes32(uint256(1)));
        address v2 = factory.createVault(alice, bytes32(uint256(2)));
        factory.createVault(bob, bytes32(uint256(1)));

        address[] memory aliceVaults = factory.vaultsOf(alice);
        assertEq(aliceVaults.length, 2);
        assertEq(aliceVaults[0], v1);
        assertEq(aliceVaults[1], v2);
        assertEq(factory.vaultCountOf(bob), 1);
    }

    function test_rejectsZeroOwner() public {
        vm.expectRevert(AgentVaultFactory.ZeroAddress.selector);
        factory.createVault(address(0), bytes32(0));
    }

    /// @dev A factory pinned to address(0) would mint vaults that can never hold
    ///      or move anything — fail at construction rather than ship dead vaults.
    function test_constructor_rejectsZeroToken() public {
        vm.expectRevert(AgentVaultFactory.ZeroAddress.selector);
        new AgentVaultFactory(address(0));
    }
}
