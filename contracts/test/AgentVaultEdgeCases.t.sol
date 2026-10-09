// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";
import {AgentVault} from "../src/AgentVault.sol";
import {IAgentVault} from "../src/interfaces/IAgentVault.sol";
import {FailingUSDC} from "./mocks/FailingUSDC.sol";
import {MockUSDC} from "./mocks/MockUSDC.sol";

/// @notice Failure-path and input-validation coverage.
///
/// @dev Split from AgentVault.t.sol because these need a token that can fail on
///      demand. The transfer-failure tests matter more than they look: the vault
///      emits PaymentExecuted *before* the transfer, and apps/service settles
///      invoices from that event — so "the token returned false and we carried
///      on" would mean an agent getting goods for free. These pin the rollback.
contract AgentVaultEdgeCasesTest is Test {
    AgentVault internal vault;
    FailingUSDC internal usdc;

    address internal operator = makeAddr("operator");
    address internal agent = makeAddr("agentSessionKey");
    address internal service = makeAddr("service");

    uint128 internal constant MAX_PER_TX = 25e6;
    uint128 internal constant DAILY_LIMIT = 40e6;
    uint256 internal constant FUNDING = 250e6;

    function setUp() public {
        vm.warp(1_760_000_000);

        usdc = new FailingUSDC();
        vault = new AgentVault(operator, address(usdc));
        usdc.mint(operator, FUNDING);

        vm.startPrank(operator);
        usdc.approve(address(vault), type(uint256).max);
        vault.deposit(FUNDING);

        address[] memory recipients = new address[](1);
        recipients[0] = service;
        vault.createSession(
            agent, MAX_PER_TX, DAILY_LIMIT, uint64(block.timestamp + 1 days), recipients
        );
        vm.stopPrank();
    }

    // =========================================================================
    // A token that returns false must not be treated as success
    // =========================================================================

    function test_pay_revertsAndRollsBackWhenTransferReturnsFalse() public {
        usdc.setFailTransfers(true);

        vm.prank(agent);
        vm.expectRevert(IAgentVault.TransferFailed.selector);
        vault.pay(address(usdc), service, 10e6, keccak256("silent_fail"));

        // The whole transaction reverted, so the pre-interaction PaymentExecuted
        // and the spend accounting are discarded together. That atomicity is
        // what makes emitting the event before the transfer sound.
        //
        // Deliberately asserted on state, not on logs: vm.recordLogs captures
        // LOG opcodes as they execute and does not unwind them on revert, so it
        // would still show the emission that no node will ever serve. State is
        // the honest witness here.
        assertEq(vault.getSession(agent).spentInWindow, 0, "budget not consumed");
        assertEq(vault.balance(), FUNDING, "balance intact");
        assertEq(vault.remainingDailyAllowance(agent), DAILY_LIMIT);
    }

    function test_withdraw_revertsWhenTransferReturnsFalse() public {
        usdc.setFailTransfers(true);

        vm.prank(operator);
        vm.expectRevert(IAgentVault.TransferFailed.selector);
        vault.withdraw(operator, 1e6);

        assertEq(vault.balance(), FUNDING);
    }

    function test_deposit_revertsWhenTransferFromReturnsFalse() public {
        usdc.setFailTransferFroms(true);

        vm.prank(operator);
        vm.expectRevert(IAgentVault.TransferFailed.selector);
        vault.deposit(1e6);

        assertEq(vault.balance(), FUNDING, "no phantom credit");
    }

    // =========================================================================
    // Input validation
    // =========================================================================

    function test_constructor_rejectsZeroOwner() public {
        vm.expectRevert(IAgentVault.ZeroAddress.selector);
        new AgentVault(address(0), address(usdc));
    }

    function test_constructor_rejectsZeroToken() public {
        vm.expectRevert(IAgentVault.ZeroAddress.selector);
        new AgentVault(operator, address(0));
    }

    function test_deposit_rejectsZeroAmount() public {
        vm.prank(operator);
        vm.expectRevert(IAgentVault.ZeroAmount.selector);
        vault.deposit(0);
    }

    function test_withdraw_rejectsZeroAmount() public {
        vm.prank(operator);
        vm.expectRevert(IAgentVault.ZeroAmount.selector);
        vault.withdraw(operator, 0);
    }

    function test_withdraw_rejectsZeroRecipient() public {
        vm.prank(operator);
        vm.expectRevert(IAgentVault.ZeroAddress.selector);
        vault.withdraw(address(0), 1e6);
    }

    function test_createSession_rejectsZeroSessionKey() public {
        address[] memory none = new address[](0);
        vm.prank(operator);
        vm.expectRevert(IAgentVault.ZeroAddress.selector);
        vault.createSession(address(0), 1e6, 1e6, uint64(block.timestamp + 1 days), none);
    }

    function test_createSession_rejectsZeroRecipientInList() public {
        address[] memory bad = new address[](2);
        bad[0] = service;
        bad[1] = address(0);

        vm.prank(operator);
        vm.expectRevert(IAgentVault.ZeroAddress.selector);
        vault.createSession(makeAddr("agent2"), 1e6, 1e6, uint64(block.timestamp + 1 days), bad);

        // The whole batch is rejected — no partial allowlist is written.
        assertFalse(vault.isRecipientAllowed(makeAddr("agent2"), service));
    }

    function test_setRecipient_rejectsZeroRecipient() public {
        vm.prank(operator);
        vm.expectRevert(IAgentVault.ZeroAddress.selector);
        vault.setRecipient(agent, address(0), true);
    }

    function test_setRecipient_rejectsUnknownSession() public {
        address ghost = makeAddr("ghost");
        vm.prank(operator);
        vm.expectRevert(abi.encodeWithSelector(IAgentVault.UnauthorizedAgent.selector, ghost));
        vault.setRecipient(ghost, service, true);
    }

    function test_setRecipients_rejectsUnknownSession() public {
        address ghost = makeAddr("ghost");
        address[] memory list = new address[](1);
        list[0] = service;

        vm.prank(operator);
        vm.expectRevert(abi.encodeWithSelector(IAgentVault.UnauthorizedAgent.selector, ghost));
        vault.setRecipients(ghost, list, true);
    }

    function test_revokeSession_rejectsUnknownSession() public {
        address ghost = makeAddr("ghost");
        vm.prank(operator);
        vm.expectRevert(abi.encodeWithSelector(IAgentVault.UnauthorizedAgent.selector, ghost));
        vault.revokeSession(ghost);
    }

    function test_updatePolicy_rejectsUnknownSession() public {
        address ghost = makeAddr("ghost");
        vm.prank(operator);
        vm.expectRevert(abi.encodeWithSelector(IAgentVault.UnauthorizedAgent.selector, ghost));
        vault.updatePolicy(ghost, 1e6, 1e6, uint64(block.timestamp + 1 days));
    }

    function test_transferOwnership_rejectsZeroAddress() public {
        vm.prank(operator);
        vm.expectRevert(IAgentVault.ZeroAddress.selector);
        vault.transferOwnership(address(0));
    }

    // =========================================================================
    // previewPay on a vault whose token differs from a lookalike
    // =========================================================================

    /// @dev previewPay must roll the day window itself, exactly as pay does.
    ///      If it read the stale `spentInWindow` it would tell an operator their
    ///      agent is out of budget on a day when the chain would permit payment.
    function test_previewPay_rollsStaleDayWindow() public {
        vm.startPrank(agent);
        vault.pay(address(usdc), service, 25e6, keccak256("a"));
        vault.pay(address(usdc), service, 15e6, keccak256("b")); // exactly at the limit
        vm.stopPrank();

        (bool ok,) = vault.previewPay(address(agent), address(usdc), service, 1e6);
        assertFalse(ok, "spent out for today");

        // Next day: the stored windowDay is now stale and must read as zero spend.
        vm.warp(vm.getBlockTimestamp() + 1 days);
        vm.prank(operator);
        vault.updatePolicy(agent, MAX_PER_TX, DAILY_LIMIT, uint64(vm.getBlockTimestamp() + 1 days));

        IAgentVault.RejectionReason reason;
        (ok, reason) = vault.previewPay(address(agent), address(usdc), service, 20e6);
        assertTrue(ok, "new window must read as unspent");
        assertEq(uint8(reason), uint8(IAgentVault.RejectionReason.NONE));
        assertEq(vault.getSession(agent).spentInWindow, 40e6, "storage still holds the old day");
    }

    function test_previewPay_unknownSessionOnEmptyVault() public {
        MockUSDC other = new MockUSDC();
        AgentVault fresh = new AgentVault(operator, address(other));

        (bool ok, IAgentVault.RejectionReason reason) =
            fresh.previewPay(agent, address(other), service, 1e6);
        assertFalse(ok);
        assertEq(uint8(reason), uint8(IAgentVault.RejectionReason.UNAUTHORIZED_AGENT));
        assertEq(fresh.remainingDailyAllowance(agent), 0);
    }
}
