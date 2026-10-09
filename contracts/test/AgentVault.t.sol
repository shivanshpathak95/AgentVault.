// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";
import {AgentVault} from "../src/AgentVault.sol";
import {IAgentVault} from "../src/interfaces/IAgentVault.sol";
import {MockUSDC} from "./mocks/MockUSDC.sol";

/// @notice Foundation test suite.
///
/// @dev Every "blocked flow" in the product spec gets its own test here. The
///      project's claim is that the contract refuses — so the refusals are the
///      part that has to be proven, not the happy path.
///
///      Phase 1 expands this with fuzz tests on the day-window arithmetic and an
///      invariant that total outflow never exceeds dailyLimit per window.
contract AgentVaultTest is Test {
    AgentVault internal vault;
    MockUSDC internal usdc;

    address internal operator = makeAddr("operator");
    address internal agent = makeAddr("agentSessionKey");
    address internal service = makeAddr("service");
    address internal attacker = makeAddr("attacker");

    uint128 internal constant MAX_PER_TX = 25e6; // 25 USDC
    uint128 internal constant DAILY_LIMIT = 40e6; // 40 USDC
    uint256 internal constant FUNDING = 250e6; // 250 USDC

    function setUp() public {
        // Start well past the epoch so day-window maths is realistic.
        vm.warp(1_760_000_000);

        usdc = new MockUSDC();
        vault = new AgentVault(operator, address(usdc));

        usdc.mint(operator, FUNDING);

        vm.startPrank(operator);
        usdc.approve(address(vault), FUNDING);
        vault.deposit(FUNDING);

        address[] memory recipients = new address[](1);
        recipients[0] = service;
        vault.createSession(
            agent, MAX_PER_TX, DAILY_LIMIT, uint64(block.timestamp + 1 days), recipients
        );
        vm.stopPrank();
    }

    // -------------------------------------------------------------------------
    // Happy path
    // -------------------------------------------------------------------------

    function test_pay_succeeds_withinPolicy() public {
        vm.prank(agent);
        vault.pay(service, 12.5e6, keccak256("inv_42"));

        assertEq(usdc.balanceOf(service), 12.5e6, "service paid");
        assertEq(vault.balance(), FUNDING - 12.5e6, "vault debited");
        assertEq(vault.remainingDailyAllowance(agent), DAILY_LIMIT - 12.5e6, "allowance tracked");
    }

    function test_pay_emitsPaymentExecuted() public {
        vm.expectEmit(true, true, true, true);
        emit IAgentVault.PaymentExecuted(agent, service, 10e6, keccak256("inv_1"), 10e6);

        vm.prank(agent);
        vault.pay(service, 10e6, keccak256("inv_1"));
    }

    // -------------------------------------------------------------------------
    // Blocked flow: unauthorized recipient  (the prompt-injection scenario)
    // -------------------------------------------------------------------------

    function test_reject_unauthorizedRecipient() public {
        vm.prank(agent);
        vm.expectRevert(abi.encodeWithSelector(IAgentVault.RecipientNotAllowed.selector, attacker));
        vault.pay(attacker, 1e6, keccak256("injected"));

        assertEq(usdc.balanceOf(attacker), 0, "attacker got nothing");
        assertEq(vault.balance(), FUNDING, "no state change");
    }

    // -------------------------------------------------------------------------
    // Blocked flow: amount exceeds maxPerTx
    // -------------------------------------------------------------------------

    function test_reject_exceedsMaxPerTx() public {
        vm.prank(agent);
        vm.expectRevert(
            abi.encodeWithSelector(IAgentVault.ExceedsMaxPerTx.selector, uint256(30e6), MAX_PER_TX)
        );
        vault.pay(service, 30e6, keccak256("too_big"));
    }

    // -------------------------------------------------------------------------
    // Blocked flow: daily limit exceeded
    // -------------------------------------------------------------------------

    function test_reject_exceedsDailyLimit() public {
        vm.startPrank(agent);
        vault.pay(service, 25e6, keccak256("a"));
        vault.pay(service, 10e6, keccak256("b")); // 35 of 40 spent

        vm.expectRevert(
            abi.encodeWithSelector(
                IAgentVault.ExceedsDailyLimit.selector, uint256(10e6), uint128(5e6)
            )
        );
        vault.pay(service, 10e6, keccak256("c"));
        vm.stopPrank();
    }

    function test_dailyLimit_resetsNextDay() public {
        vm.startPrank(agent);
        vault.pay(service, 25e6, keccak256("a"));
        vault.pay(service, 15e6, keccak256("b")); // exactly at the 40 limit
        assertEq(vault.remainingDailyAllowance(agent), 0);
        vm.stopPrank();

        // Cross into the next day, then extend the session past the new window.
        // vm.getBlockTimestamp() rather than block.timestamp: the latter is read
        // once per call frame, so reusing it after vm.warp silently yields the
        // pre-warp value and the expiry below would land in the past.
        vm.warp(vm.getBlockTimestamp() + 1 days);
        vm.prank(operator);
        vault.updateSessionPolicy(
            agent, MAX_PER_TX, DAILY_LIMIT, uint64(vm.getBlockTimestamp() + 1 days)
        );

        assertEq(vault.remainingDailyAllowance(agent), DAILY_LIMIT, "window rolled");

        vm.prank(agent);
        vault.pay(service, 20e6, keccak256("d"));
        assertEq(usdc.balanceOf(service), 60e6);
    }

    // -------------------------------------------------------------------------
    // Blocked flow: expired session
    // -------------------------------------------------------------------------

    function test_reject_expiredSession() public {
        vm.warp(block.timestamp + 2 days);

        vm.prank(agent);
        vm.expectRevert(IAgentVault.SessionExpired.selector);
        vault.pay(service, 1e6, keccak256("late"));
    }

    // -------------------------------------------------------------------------
    // Blocked flow: revoked session
    // -------------------------------------------------------------------------

    function test_reject_revokedSession() public {
        vm.prank(operator);
        vault.revokeSession(agent);

        vm.prank(agent);
        vm.expectRevert(IAgentVault.SessionRevoked_.selector);
        vault.pay(service, 1e6, keccak256("revoked"));
    }

    function test_revocation_isPermanent() public {
        vm.startPrank(operator);
        vault.revokeSession(agent);

        address[] memory recipients = new address[](1);
        recipients[0] = service;

        // The kill switch must not degrade into a pause button.
        vm.expectRevert(IAgentVault.SessionRevoked_.selector);
        vault.createSession(
            agent, MAX_PER_TX, DAILY_LIMIT, uint64(block.timestamp + 1 days), recipients
        );
        vm.stopPrank();
    }

    // -------------------------------------------------------------------------
    // Blocked flow: unknown key
    // -------------------------------------------------------------------------

    function test_reject_unknownSessionKey() public {
        vm.prank(attacker);
        vm.expectRevert(IAgentVault.SessionUnknown.selector);
        vault.pay(service, 1e6, keccak256("stranger"));
    }

    // -------------------------------------------------------------------------
    // Authority separation — the central claim
    // -------------------------------------------------------------------------

    function test_sessionKey_cannotWidenItsOwnPolicy() public {
        vm.startPrank(agent);

        vm.expectRevert(IAgentVault.NotOwner.selector);
        vault.updateSessionPolicy(
            agent, type(uint128).max, type(uint128).max, uint64(block.timestamp + 365 days)
        );

        vm.expectRevert(IAgentVault.NotOwner.selector);
        vault.setRecipient(agent, attacker, true);

        vm.expectRevert(IAgentVault.NotOwner.selector);
        vault.withdraw(attacker, 1e6);

        vm.expectRevert(IAgentVault.NotOwner.selector);
        vault.transferOwnership(attacker);

        vm.stopPrank();

        assertEq(vault.balance(), FUNDING, "nothing moved");
        assertEq(vault.owner(), operator, "owner unchanged");
    }

    function test_owner_canAlwaysWithdraw() public {
        vm.prank(operator);
        vault.withdraw(operator, FUNDING);
        assertEq(vault.balance(), 0);
        assertEq(usdc.balanceOf(operator), FUNDING);
    }

    // -------------------------------------------------------------------------
    // previewPay must mirror pay exactly
    // -------------------------------------------------------------------------

    function test_previewPay_mirrorsPay() public view {
        (bool ok, IAgentVault.RejectionReason reason) = vault.previewPay(agent, service, 12.5e6);
        assertTrue(ok);
        assertEq(uint8(reason), uint8(IAgentVault.RejectionReason.NONE));

        (ok, reason) = vault.previewPay(agent, attacker, 1e6);
        assertFalse(ok);
        assertEq(uint8(reason), uint8(IAgentVault.RejectionReason.RECIPIENT_NOT_ALLOWED));

        (ok, reason) = vault.previewPay(agent, service, 30e6);
        assertFalse(ok);
        assertEq(uint8(reason), uint8(IAgentVault.RejectionReason.EXCEEDS_MAX_PER_TX));
    }

    /// @dev Fuzz: whatever the amount, preview and pay agree on the verdict.
    ///      A disagreement means the UI can promise something the chain refuses.
    function testFuzz_previewPay_agreesWithPay(uint96 amount) public {
        (bool predicted,) = vault.previewPay(agent, service, amount);

        vm.prank(agent);
        try vault.pay(service, amount, keccak256("fuzz")) {
            assertTrue(predicted, "pay succeeded but preview said no");
        } catch {
            assertFalse(predicted, "pay reverted but preview said yes");
        }
    }

    /// @dev Fuzz: no sequence of single-day payments can exceed dailyLimit.
    function testFuzz_dailyLimitIsNeverExceeded(uint96 a, uint96 b, uint96 c) public {
        uint256 before = usdc.balanceOf(service);

        vm.startPrank(agent);
        try vault.pay(service, a, keccak256("1")) {} catch {}
        try vault.pay(service, b, keccak256("2")) {} catch {}
        try vault.pay(service, c, keccak256("3")) {} catch {}
        vm.stopPrank();

        assertLe(usdc.balanceOf(service) - before, DAILY_LIMIT, "daily limit breached");
    }

    // -------------------------------------------------------------------------
    // Phase-2 surface is declared but inert
    // -------------------------------------------------------------------------

    function test_payWithIntent_isNotImplemented() public {
        IAgentVault.PaymentIntent memory intent;
        vm.expectRevert(IAgentVault.NotImplemented.selector);
        vault.payWithIntent(intent, "");
    }
}
