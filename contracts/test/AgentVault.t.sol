// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test, Vm} from "forge-std/Test.sol";
import {AgentVault} from "../src/AgentVault.sol";
import {IAgentVault} from "../src/interfaces/IAgentVault.sol";
import {MockUSDC} from "./mocks/MockUSDC.sol";

/// @notice AgentVault enforcement tests.
///
/// @dev The product's claim is that the contract REFUSES. So the refusals are
///      what has to be proven, not the happy path — every blocked flow gets its
///      own test asserting both the specific custom error and that no state
///      changed.
///
///      Layout: happy path, then one section per security check in the same
///      order `pay` evaluates them, then daily-limit accounting, then expiry,
///      then authority separation, then previewPay/fuzz.
contract AgentVaultTest is Test {
    AgentVault internal vault;
    MockUSDC internal usdc;
    MockUSDC internal otherToken;

    address internal operator = makeAddr("operator");
    address internal agent = makeAddr("agentSessionKey");
    address internal service = makeAddr("service");
    address internal attacker = makeAddr("attacker");

    uint128 internal constant MAX_PER_TX = 25e6; // 25 USDC
    uint128 internal constant DAILY_LIMIT = 40e6; // 40 USDC
    uint256 internal constant FUNDING = 250e6; // 250 USDC

    uint64 internal expiry;

    function setUp() public {
        // Start well past the epoch so day-window maths is realistic, and land
        // mid-day so tests are not accidentally sitting on a window boundary.
        vm.warp(1_760_000_000);

        usdc = new MockUSDC();
        otherToken = new MockUSDC();
        vault = new AgentVault(operator, address(usdc));

        usdc.mint(operator, FUNDING);
        expiry = uint64(block.timestamp + 1 days);

        vm.startPrank(operator);
        usdc.approve(address(vault), FUNDING);
        vault.deposit(FUNDING);

        address[] memory recipients = new address[](1);
        recipients[0] = service;
        vault.createSession(agent, MAX_PER_TX, DAILY_LIMIT, expiry, recipients);
        vm.stopPrank();
    }

    // =========================================================================
    // Happy path
    // =========================================================================

    function test_pay_succeeds_withinPolicy() public {
        vm.prank(agent);
        vault.pay(address(usdc), service, 12.5e6, keccak256("inv_42"));

        assertEq(usdc.balanceOf(service), 12.5e6, "service paid");
        assertEq(vault.balance(), FUNDING - 12.5e6, "vault debited");
        assertEq(vault.remainingDailyAllowance(agent), DAILY_LIMIT - 12.5e6, "allowance tracked");
    }

    function test_pay_emitsPaymentExecuted() public {
        vm.expectEmit(true, true, true, true);
        emit IAgentVault.PaymentExecuted(
            agent, service, address(usdc), 10e6, keccak256("inv_1"), 10e6
        );

        vm.prank(agent);
        vault.pay(address(usdc), service, 10e6, keccak256("inv_1"));
    }

    function test_pay_multiplePaymentsAccumulateInWindow() public {
        vm.startPrank(agent);
        vault.pay(address(usdc), service, 10e6, keccak256("a"));
        vault.pay(address(usdc), service, 5e6, keccak256("b"));
        vm.stopPrank();

        assertEq(usdc.balanceOf(service), 15e6);
        assertEq(vault.getSession(agent).spentInWindow, 15e6);
        assertEq(vault.remainingDailyAllowance(agent), DAILY_LIMIT - 15e6);
    }

    function test_pay_atExactMaxPerTx_succeeds() public {
        vm.prank(agent);
        vault.pay(address(usdc), service, MAX_PER_TX, keccak256("exact"));
        assertEq(usdc.balanceOf(service), MAX_PER_TX);
    }

    // =========================================================================
    // Security check 0 — global pause (operator control)
    // =========================================================================

    function test_reject_whenPaused() public {
        vm.prank(operator);
        vault.setPaused(true);

        vm.prank(agent);
        vm.expectRevert(IAgentVault.VaultPaused.selector);
        vault.pay(address(usdc), service, 1e6, keccak256("frozen"));

        assertEq(vault.balance(), FUNDING, "no state change");
        assertEq(vault.remainingDailyAllowance(agent), 0, "paused reports no allowance");
    }

    function test_pause_isReversible() public {
        vm.prank(operator);
        vault.setPaused(true);
        vm.prank(operator);
        vault.setPaused(false);

        vm.prank(agent);
        vault.pay(address(usdc), service, 1e6, keccak256("thawed"));
        assertEq(usdc.balanceOf(service), 1e6);
    }

    // =========================================================================
    // Security check 1 — caller/session is authorized
    // =========================================================================

    function test_reject_unauthorizedCaller() public {
        vm.prank(attacker);
        vm.expectRevert(abi.encodeWithSelector(IAgentVault.UnauthorizedAgent.selector, attacker));
        vault.pay(address(usdc), service, 1e6, keccak256("stranger"));

        assertEq(vault.balance(), FUNDING, "no state change");
    }

    /// @dev Even the owner is not a session key. Authority to set policy is not
    ///      authority to spend under it.
    function test_reject_ownerIsNotASessionKey() public {
        vm.prank(operator);
        vm.expectRevert(abi.encodeWithSelector(IAgentVault.UnauthorizedAgent.selector, operator));
        vault.pay(address(usdc), service, 1e6, keccak256("owner"));
    }

    // =========================================================================
    // Security check 2 — session is active (not revoked)
    // =========================================================================

    function test_reject_revokedSession() public {
        vm.prank(operator);
        vault.revokeSession(agent);

        vm.prank(agent);
        vm.expectRevert(IAgentVault.SessionIsRevoked.selector);
        vault.pay(address(usdc), service, 1e6, keccak256("revoked"));

        assertEq(vault.balance(), FUNDING, "no state change");
    }

    function test_revocation_isPermanent() public {
        vm.startPrank(operator);
        vault.revokeSession(agent);

        address[] memory recipients = new address[](1);
        recipients[0] = service;

        // The kill switch must not degrade into a pause button.
        vm.expectRevert(IAgentVault.SessionIsRevoked.selector);
        vault.createSession(
            agent, MAX_PER_TX, DAILY_LIMIT, uint64(block.timestamp + 1 days), recipients
        );

        vm.expectRevert(IAgentVault.SessionIsRevoked.selector);
        vault.updatePolicy(agent, MAX_PER_TX, DAILY_LIMIT, uint64(block.timestamp + 1 days));
        vm.stopPrank();
    }

    function test_revoke_midStreamStopsFurtherSpending() public {
        vm.prank(agent);
        vault.pay(address(usdc), service, 10e6, keccak256("before"));

        vm.prank(operator);
        vault.revokeSession(agent);

        vm.prank(agent);
        vm.expectRevert(IAgentVault.SessionIsRevoked.selector);
        vault.pay(address(usdc), service, 1e6, keccak256("after"));

        assertEq(usdc.balanceOf(service), 10e6, "only the pre-revocation payment landed");
    }

    // =========================================================================
    // Security check 3 — current time is before expiry
    // =========================================================================

    function test_reject_expiredSession() public {
        vm.warp(uint256(expiry) + 1);

        vm.prank(agent);
        vm.expectRevert(
            abi.encodeWithSelector(IAgentVault.SessionExpired.selector, expiry, block.timestamp)
        );
        vault.pay(address(usdc), service, 1e6, keccak256("late"));
    }

    /// @dev Expiry is exclusive: `block.timestamp >= expiresAt` is expired. A
    ///      session must not be usable in the very second it lapses.
    function test_expiry_isExclusiveAtTheBoundary() public {
        vm.warp(expiry - 1);
        vm.prank(agent);
        vault.pay(address(usdc), service, 1e6, keccak256("just_in_time"));
        assertEq(usdc.balanceOf(service), 1e6);

        vm.warp(expiry);
        vm.prank(agent);
        vm.expectRevert(abi.encodeWithSelector(IAgentVault.SessionExpired.selector, expiry, expiry));
        vault.pay(address(usdc), service, 1e6, keccak256("one_second_late"));
    }

    function test_createSession_rejectsPastExpiry() public {
        address[] memory recipients = new address[](0);
        vm.prank(operator);
        vm.expectRevert(IAgentVault.InvalidExpiry.selector);
        vault.createSession(attacker, 1e6, 1e6, uint64(block.timestamp), recipients);
    }

    function test_updatePolicy_rejectsPastExpiry() public {
        vm.prank(operator);
        vm.expectRevert(IAgentVault.InvalidExpiry.selector);
        vault.updatePolicy(agent, MAX_PER_TX, DAILY_LIMIT, uint64(block.timestamp - 1));
    }

    function test_expiredSession_reportsNoAllowance() public {
        vm.warp(uint256(expiry) + 1);
        assertEq(vault.remainingDailyAllowance(agent), 0);
    }

    // =========================================================================
    // Security check 4 — token is the configured USDC
    // =========================================================================

    function test_reject_wrongToken() public {
        vm.prank(agent);
        vm.expectRevert(
            abi.encodeWithSelector(
                IAgentVault.InvalidToken.selector, address(otherToken), address(usdc)
            )
        );
        vault.pay(address(otherToken), service, 1e6, keccak256("wrong_token"));

        assertEq(vault.balance(), FUNDING, "no state change");
    }

    function test_reject_zeroAddressToken() public {
        vm.prank(agent);
        vm.expectRevert(
            abi.encodeWithSelector(IAgentVault.InvalidToken.selector, address(0), address(usdc))
        );
        vault.pay(address(0), service, 1e6, keccak256("null_token"));
    }

    // =========================================================================
    // Security check 5 — recipient is approved  (the prompt-injection scenario)
    // =========================================================================

    function test_reject_unauthorizedRecipient() public {
        vm.prank(agent);
        vm.expectRevert(abi.encodeWithSelector(IAgentVault.RecipientNotAllowed.selector, attacker));
        vault.pay(address(usdc), attacker, 1e6, keccak256("injected"));

        assertEq(usdc.balanceOf(attacker), 0, "attacker got nothing");
        assertEq(vault.balance(), FUNDING, "no state change");
    }

    function test_recipient_canBeRemoved() public {
        vm.prank(operator);
        vault.setRecipient(agent, service, false);

        vm.prank(agent);
        vm.expectRevert(abi.encodeWithSelector(IAgentVault.RecipientNotAllowed.selector, service));
        vault.pay(address(usdc), service, 1e6, keccak256("delisted"));
    }

    function test_setRecipients_batch() public {
        address a = makeAddr("vendorA");
        address b = makeAddr("vendorB");
        address[] memory batch = new address[](2);
        batch[0] = a;
        batch[1] = b;

        vm.prank(operator);
        vault.setRecipients(agent, batch, true);

        assertTrue(vault.isRecipientAllowed(agent, a));
        assertTrue(vault.isRecipientAllowed(agent, b));

        vm.prank(operator);
        vault.setRecipients(agent, batch, false);
        assertFalse(vault.isRecipientAllowed(agent, a));
        assertFalse(vault.isRecipientAllowed(agent, b));
    }

    /// @dev An allowlist is per session, not per vault: a second agent must not
    ///      inherit the first agent's approved recipients.
    function test_allowlist_isScopedPerSession() public {
        address agent2 = makeAddr("agent2");
        address[] memory none = new address[](0);

        vm.prank(operator);
        vault.createSession(agent2, MAX_PER_TX, DAILY_LIMIT, expiry, none);

        assertTrue(vault.isRecipientAllowed(agent, service));
        assertFalse(vault.isRecipientAllowed(agent2, service));

        vm.prank(agent2);
        vm.expectRevert(abi.encodeWithSelector(IAgentVault.RecipientNotAllowed.selector, service));
        vault.pay(address(usdc), service, 1e6, keccak256("borrowed_allowlist"));
    }

    // =========================================================================
    // Security check 6 — amount <= maxPerTx
    // =========================================================================

    function test_reject_exceedsMaxPerTx() public {
        vm.prank(agent);
        vm.expectRevert(
            abi.encodeWithSelector(IAgentVault.ExceedsMaxPerTx.selector, uint256(30e6), MAX_PER_TX)
        );
        vault.pay(address(usdc), service, 30e6, keccak256("too_big"));
    }

    function test_reject_maxPerTxOffByOne() public {
        vm.prank(agent);
        vm.expectRevert(
            abi.encodeWithSelector(
                IAgentVault.ExceedsMaxPerTx.selector, uint256(MAX_PER_TX) + 1, MAX_PER_TX
            )
        );
        vault.pay(address(usdc), service, uint256(MAX_PER_TX) + 1, keccak256("one_over"));
    }

    function test_reject_zeroAmount() public {
        vm.prank(agent);
        vm.expectRevert(IAgentVault.ZeroAmount.selector);
        vault.pay(address(usdc), service, 0, keccak256("nothing"));
    }

    // =========================================================================
    // Security check 7 — daily limit  (+ accounting edge cases)
    // =========================================================================

    function test_reject_dailyLimitExceeded() public {
        vm.startPrank(agent);
        vault.pay(address(usdc), service, 25e6, keccak256("a"));
        vault.pay(address(usdc), service, 10e6, keccak256("b")); // 35 of 40 spent

        vm.expectRevert(
            abi.encodeWithSelector(
                IAgentVault.DailyLimitExceeded.selector, uint256(10e6), uint128(5e6)
            )
        );
        vault.pay(address(usdc), service, 10e6, keccak256("c"));
        vm.stopPrank();

        assertEq(usdc.balanceOf(service), 35e6, "only the permitted payments landed");
    }

    function test_dailyLimit_exactBoundaryThenOneWeiOver() public {
        vm.startPrank(agent);
        vault.pay(address(usdc), service, 25e6, keccak256("a"));
        vault.pay(address(usdc), service, 15e6, keccak256("b")); // exactly 40
        assertEq(vault.remainingDailyAllowance(agent), 0);

        vm.expectRevert(
            abi.encodeWithSelector(IAgentVault.DailyLimitExceeded.selector, uint256(1), uint128(0))
        );
        vault.pay(address(usdc), service, 1, keccak256("one_wei"));
        vm.stopPrank();
    }

    function test_dailyLimit_resetsNextDay() public {
        vm.startPrank(agent);
        vault.pay(address(usdc), service, 25e6, keccak256("a"));
        vault.pay(address(usdc), service, 15e6, keccak256("b")); // exactly at the limit
        assertEq(vault.remainingDailyAllowance(agent), 0);
        vm.stopPrank();

        // Cross into the next day, then extend the session past the new window.
        // vm.getBlockTimestamp() rather than block.timestamp: the latter is read
        // once per call frame, so reusing it after vm.warp silently yields the
        // pre-warp value and the expiry below would land in the past.
        vm.warp(vm.getBlockTimestamp() + 1 days);
        vm.prank(operator);
        vault.updatePolicy(agent, MAX_PER_TX, DAILY_LIMIT, uint64(vm.getBlockTimestamp() + 1 days));

        assertEq(vault.remainingDailyAllowance(agent), DAILY_LIMIT, "window rolled");

        vm.prank(agent);
        vault.pay(address(usdc), service, 20e6, keccak256("d"));
        assertEq(usdc.balanceOf(service), 60e6);
    }

    /// @dev The window is a UTC-day bucket, so the reset happens at the day
    ///      boundary — not 24h after the last payment.
    function test_dailyLimit_rollsAtDayBoundaryNotRollingWindow() public {
        // Move to one second before a day boundary.
        uint256 boundary = ((vm.getBlockTimestamp() / 1 days) + 1) * 1 days;
        vm.warp(boundary - 1);

        vm.prank(operator);
        vault.updatePolicy(agent, MAX_PER_TX, DAILY_LIMIT, uint64(boundary + 2 days));

        // Two payments, because a single DAILY_LIMIT payment would trip
        // maxPerTx first and this test is about the window, not the ceiling.
        vm.startPrank(agent);
        vault.pay(address(usdc), service, 25e6, keccak256("end_of_day_1"));
        vault.pay(address(usdc), service, 15e6, keccak256("end_of_day_2"));
        vm.stopPrank();
        assertEq(vault.remainingDailyAllowance(agent), 0);

        // One second later the bucket changes and the allowance is whole again.
        vm.warp(boundary);
        assertEq(vault.remainingDailyAllowance(agent), DAILY_LIMIT, "new day, new budget");

        vm.prank(agent);
        vault.pay(address(usdc), service, 20e6, keccak256("next_day"));
        assertEq(usdc.balanceOf(service), uint256(DAILY_LIMIT) + 20e6);
    }

    /// @dev Re-saving a policy must not hand back a fresh daily allowance, or
    ///      the limit would be bypassable by an innocuous-looking owner action.
    function test_updatePolicy_doesNotResetSpentInWindow() public {
        vm.prank(agent);
        vault.pay(address(usdc), service, 20e6, keccak256("spend"));
        assertEq(vault.remainingDailyAllowance(agent), 20e6);

        vm.prank(operator);
        vault.updatePolicy(agent, MAX_PER_TX, DAILY_LIMIT, expiry);

        assertEq(vault.remainingDailyAllowance(agent), 20e6, "spend survived the policy update");
        assertEq(vault.getSession(agent).spentInWindow, 20e6);
    }

    /// @dev Tightening the limit below what is already spent must clamp to zero,
    ///      never underflow into a huge allowance.
    function test_dailyLimit_loweredBelowSpent_clampsToZero() public {
        vm.prank(agent);
        vault.pay(address(usdc), service, 20e6, keccak256("spend"));

        vm.prank(operator);
        vault.updatePolicy(agent, MAX_PER_TX, 5e6, expiry); // below the 20 already spent

        assertEq(vault.remainingDailyAllowance(agent), 0, "clamped, not underflowed");

        vm.prank(agent);
        vm.expectRevert(
            abi.encodeWithSelector(IAgentVault.DailyLimitExceeded.selector, uint256(1), uint128(0))
        );
        vault.pay(address(usdc), service, 1, keccak256("after_tighten"));
    }

    function test_newSession_startsWithFullAllowanceSameDay() public {
        vm.prank(agent);
        vault.pay(address(usdc), service, 20e6, keccak256("agent1_spend"));

        address agent2 = makeAddr("agent2");
        address[] memory recipients = new address[](1);
        recipients[0] = service;
        vm.prank(operator);
        vault.createSession(agent2, MAX_PER_TX, DAILY_LIMIT, expiry, recipients);

        // Budgets are per session, not shared across the vault.
        assertEq(vault.remainingDailyAllowance(agent), DAILY_LIMIT - 20e6);
        assertEq(vault.remainingDailyAllowance(agent2), DAILY_LIMIT);
    }

    // =========================================================================
    // Security check 8 — sufficient vault balance
    // =========================================================================

    function test_reject_insufficientBalance() public {
        // Drain the vault so the balance check is the one that bites — every
        // earlier check must still pass for this to be a real test of check 8.
        vm.prank(operator);
        vault.withdraw(operator, FUNDING - 1e6);
        assertEq(vault.balance(), 1e6);

        vm.prank(agent);
        vm.expectRevert(
            abi.encodeWithSelector(
                IAgentVault.InsufficientBalance.selector, uint256(5e6), uint256(1e6)
            )
        );
        vault.pay(address(usdc), service, 5e6, keccak256("broke"));
    }

    // =========================================================================
    // Rejections leave no trace — the reason the design has no PaymentRejected
    // =========================================================================

    /// @dev A refused payment reverts, so its logs are discarded. This test
    ///      pins that behaviour: there is no on-chain record of a rejection to
    ///      index, which is exactly why rejections are surfaced through
    ///      previewPay and decoded custom errors instead of an event.
    function test_rejectedPayment_emitsNoLogsAndChangesNoState() public {
        uint128 spentBefore = vault.getSession(agent).spentInWindow;

        vm.recordLogs();
        vm.prank(agent);
        try vault.pay(address(usdc), attacker, 1e6, keccak256("injected")) {
            revert("expected revert");
        } catch {}
        Vm.Log[] memory logs = vm.getRecordedLogs();

        assertEq(logs.length, 0, "a reverted payment emits nothing");
        assertEq(vault.balance(), FUNDING, "balance untouched");
        assertEq(vault.getSession(agent).spentInWindow, spentBefore, "accounting untouched");
    }

    // =========================================================================
    // Authority separation — the central claim
    // =========================================================================

    function test_sessionKey_cannotCallAnyOwnerFunction() public {
        address[] memory list = new address[](1);
        list[0] = attacker;

        vm.startPrank(agent);

        vm.expectRevert(IAgentVault.NotOwner.selector);
        vault.updatePolicy(
            agent, type(uint128).max, type(uint128).max, uint64(block.timestamp + 365 days)
        );

        vm.expectRevert(IAgentVault.NotOwner.selector);
        vault.setRecipient(agent, attacker, true);

        vm.expectRevert(IAgentVault.NotOwner.selector);
        vault.setRecipients(agent, list, true);

        vm.expectRevert(IAgentVault.NotOwner.selector);
        vault.withdraw(attacker, 1e6);

        vm.expectRevert(IAgentVault.NotOwner.selector);
        vault.transferOwnership(attacker);

        vm.expectRevert(IAgentVault.NotOwner.selector);
        vault.createSession(attacker, 1e6, 1e6, uint64(block.timestamp + 1 days), list);

        vm.expectRevert(IAgentVault.NotOwner.selector);
        vault.revokeSession(agent);

        vm.expectRevert(IAgentVault.NotOwner.selector);
        vault.setPaused(true);

        vm.stopPrank();

        assertEq(vault.balance(), FUNDING, "nothing moved");
        assertEq(vault.owner(), operator, "owner unchanged");
        assertFalse(vault.paused());
    }

    function test_owner_canWithdrawEvenWhenPaused() public {
        vm.startPrank(operator);
        vault.setPaused(true);
        vault.withdraw(operator, FUNDING);
        vm.stopPrank();

        assertEq(vault.balance(), 0, "the human is never locked out");
        assertEq(usdc.balanceOf(operator), FUNDING);
    }

    function test_createSession_rejectsDuplicate() public {
        address[] memory recipients = new address[](0);
        vm.prank(operator);
        vm.expectRevert(IAgentVault.SessionAlreadyExists.selector);
        vault.createSession(agent, MAX_PER_TX, DAILY_LIMIT, expiry, recipients);
    }

    function test_transferOwnership_movesAuthority() public {
        address newOwner = makeAddr("newOwner");

        vm.prank(operator);
        vault.transferOwnership(newOwner);

        assertEq(vault.owner(), newOwner);

        vm.prank(operator);
        vm.expectRevert(IAgentVault.NotOwner.selector);
        vault.setPaused(true);

        vm.prank(newOwner);
        vault.setPaused(true);
        assertTrue(vault.paused());
    }

    /// @dev Funding is permissionless — anyone may top a vault up — but only the
    ///      owner can ever take funds out.
    function test_deposit_isPermissionless() public {
        address benefactor = makeAddr("benefactor");
        usdc.mint(benefactor, 10e6);

        vm.startPrank(benefactor);
        usdc.approve(address(vault), 10e6);
        vault.deposit(10e6);
        vm.stopPrank();

        assertEq(vault.balance(), FUNDING + 10e6);

        vm.prank(benefactor);
        vm.expectRevert(IAgentVault.NotOwner.selector);
        vault.withdraw(benefactor, 10e6);
    }

    // =========================================================================
    // previewPay must mirror pay exactly
    // =========================================================================

    function test_previewPay_reportsEveryReason() public view {
        bool ok;
        IAgentVault.RejectionReason reason;

        (ok, reason) = vault.previewPay(agent, address(usdc), service, 12.5e6);
        assertTrue(ok);
        assertEq(uint8(reason), uint8(IAgentVault.RejectionReason.NONE));

        (ok, reason) = vault.previewPay(attacker, address(usdc), service, 1e6);
        assertEq(uint8(reason), uint8(IAgentVault.RejectionReason.UNAUTHORIZED_AGENT));

        (ok, reason) = vault.previewPay(agent, address(otherToken), service, 1e6);
        assertEq(uint8(reason), uint8(IAgentVault.RejectionReason.INVALID_TOKEN));

        (ok, reason) = vault.previewPay(agent, address(usdc), attacker, 1e6);
        assertEq(uint8(reason), uint8(IAgentVault.RejectionReason.RECIPIENT_NOT_ALLOWED));

        (ok, reason) = vault.previewPay(agent, address(usdc), service, 0);
        assertEq(uint8(reason), uint8(IAgentVault.RejectionReason.ZERO_AMOUNT));

        (ok, reason) = vault.previewPay(agent, address(usdc), service, 30e6);
        assertEq(uint8(reason), uint8(IAgentVault.RejectionReason.EXCEEDS_MAX_PER_TX));

        assertFalse(ok);
    }

    function test_previewPay_reportsDailyLimit() public {
        vm.startPrank(agent);
        vault.pay(address(usdc), service, 25e6, keccak256("a"));
        vault.pay(address(usdc), service, 15e6, keccak256("b"));
        vm.stopPrank();

        (bool ok, IAgentVault.RejectionReason reason) =
            vault.previewPay(agent, address(usdc), service, 1e6);
        assertFalse(ok);
        assertEq(uint8(reason), uint8(IAgentVault.RejectionReason.DAILY_LIMIT_EXCEEDED));
    }

    function test_previewPay_reportsRevokedExpiredAndPaused() public {
        bool ok;
        IAgentVault.RejectionReason reason;

        vm.prank(operator);
        vault.setPaused(true);
        (ok, reason) = vault.previewPay(agent, address(usdc), service, 1e6);
        assertEq(uint8(reason), uint8(IAgentVault.RejectionReason.VAULT_PAUSED));
        vm.prank(operator);
        vault.setPaused(false);

        vm.warp(uint256(expiry) + 1);
        (ok, reason) = vault.previewPay(agent, address(usdc), service, 1e6);
        assertEq(uint8(reason), uint8(IAgentVault.RejectionReason.SESSION_EXPIRED));

        vm.prank(operator);
        vault.revokeSession(agent);
        (ok, reason) = vault.previewPay(agent, address(usdc), service, 1e6);
        assertEq(uint8(reason), uint8(IAgentVault.RejectionReason.SESSION_REVOKED));

        assertFalse(ok);
    }

    function test_previewPay_reportsInsufficientBalance() public {
        vm.prank(operator);
        vault.withdraw(operator, FUNDING);

        (bool ok, IAgentVault.RejectionReason reason) =
            vault.previewPay(agent, address(usdc), service, 5e6);
        assertFalse(ok);
        assertEq(uint8(reason), uint8(IAgentVault.RejectionReason.INSUFFICIENT_BALANCE));
    }

    /// @dev Whatever the amount, preview and pay agree on the verdict. A
    ///      disagreement means the UI can promise something the chain refuses.
    function testFuzz_previewPay_agreesWithPay(uint96 amount) public {
        (bool predicted,) = vault.previewPay(agent, address(usdc), service, amount);

        vm.prank(agent);
        try vault.pay(address(usdc), service, amount, keccak256("fuzz")) {
            assertTrue(predicted, "pay succeeded but preview said no");
        } catch {
            assertFalse(predicted, "pay reverted but preview said yes");
        }
    }

    // =========================================================================
    // Invariant-style fuzz
    // =========================================================================

    /// @dev No sequence of same-day payments can exceed dailyLimit.
    function testFuzz_dailyLimitIsNeverExceeded(uint96 a, uint96 b, uint96 c) public {
        uint256 before = usdc.balanceOf(service);

        vm.startPrank(agent);
        try vault.pay(address(usdc), service, a, keccak256("1")) {} catch {}
        try vault.pay(address(usdc), service, b, keccak256("2")) {} catch {}
        try vault.pay(address(usdc), service, c, keccak256("3")) {} catch {}
        vm.stopPrank();

        assertLe(usdc.balanceOf(service) - before, DAILY_LIMIT, "daily limit breached");
    }

    /// @dev No caller other than a live session key can ever move funds, for any
    ///      combination of caller, token, recipient and amount.
    function testFuzz_onlyAllowlistedRecipientsEverReceive(
        address caller,
        address to,
        uint96 amount
    ) public {
        vm.assume(to != address(vault));
        uint256 serviceBefore = usdc.balanceOf(service);
        uint256 toBefore = usdc.balanceOf(to);

        vm.prank(caller);
        try vault.pay(address(usdc), to, amount, keccak256("fuzz")) {
            // A payment only ever succeeds for the one allowlisted recipient.
            assertEq(caller, agent, "a non-session caller moved funds");
            assertEq(to, service, "a non-allowlisted recipient was paid");
        } catch {
            assertEq(usdc.balanceOf(service), serviceBefore);
            if (to != service) assertEq(usdc.balanceOf(to), toBefore);
        }
    }

    // =========================================================================
    // Phase-2 surface is declared but inert
    // =========================================================================

    function test_payWithIntent_isNotImplemented() public {
        IAgentVault.PaymentIntent memory intent;
        vm.expectRevert(IAgentVault.NotImplemented.selector);
        vault.payWithIntent(intent, "");
    }
}
