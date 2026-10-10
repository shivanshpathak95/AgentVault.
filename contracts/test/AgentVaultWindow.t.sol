// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";
import {AgentVault} from "../src/AgentVault.sol";
import {IAgentVault} from "../src/interfaces/IAgentVault.sol";
import {MockUSDC} from "./mocks/MockUSDC.sol";

/// @notice Daily-window semantics, pinned explicitly.
///
/// @dev "Daily limit" here means a UTC CALENDAR-DAY bucket
///      (`block.timestamp / 1 days`), not a rolling 24-hour window. Those are
///      not equivalent, and the difference is the subject of this file:
///
///        1. Calendar buckets permit up to 2x dailyLimit within a short span
///           straddling midnight UTC. That is inherent to the design and is
///           documented rather than hidden — see test_calendarBoundary_*.
///
///        2. Arc documents that block timestamps are proposer wall-clock and
///           NOT strictly monotonic. A window that treats "the day changed" as
///           "reset the budget" would also reset on a BACKWARDS step, and
///           oscillation across midnight could then reset it repeatedly. The
///           window must only ever roll forward.
contract AgentVaultWindowTest is Test {
    AgentVault internal vault;
    MockUSDC internal usdc;

    address internal operator = makeAddr("operator");
    address internal agent = makeAddr("agent");
    address internal service = makeAddr("service");

    uint128 internal constant MAX_PER_TX = 40e6;
    uint128 internal constant DAILY_LIMIT = 40e6;

    uint256 internal midnight;

    function setUp() public {
        // Park one hour before a UTC midnight.
        midnight = ((uint256(1_760_000_000) / 1 days) + 1) * 1 days;
        vm.warp(midnight - 1 hours);

        usdc = new MockUSDC();
        vault = new AgentVault(operator, address(usdc));
        usdc.mint(operator, 1_000e6);

        vm.startPrank(operator);
        usdc.approve(address(vault), 1_000e6);
        vault.deposit(1_000e6);
        address[] memory r = new address[](1);
        r[0] = service;
        vault.createSession(agent, MAX_PER_TX, DAILY_LIMIT, uint64(midnight + 7 days), r);
        vm.stopPrank();
    }

    /// @dev Arc-specific: a timestamp that steps back across midnight must NOT
    ///      hand the agent a fresh budget.
    function test_backwardsTimestamp_doesNotResetBudget() public {
        // Spend the full limit just after midnight (day D).
        vm.warp(midnight + 5);
        vm.prank(agent);
        vault.pay(address(usdc), service, DAILY_LIMIT, keccak256("d"));
        assertEq(vault.remainingDailyAllowance(agent), 0);

        // The next block's proposer clock is a few seconds behind: day D-1.
        vm.warp(midnight - 5);

        assertEq(vault.remainingDailyAllowance(agent), 0, "budget must not reappear");

        vm.prank(agent);
        vm.expectRevert(
            abi.encodeWithSelector(IAgentVault.DailyLimitExceeded.selector, uint256(1), uint128(0))
        );
        vault.pay(address(usdc), service, 1, keccak256("back"));

        (bool ok, IAgentVault.RejectionReason reason) =
            vault.previewPay(agent, address(usdc), service, 1);
        assertFalse(ok);
        assertEq(uint8(reason), uint8(IAgentVault.RejectionReason.DAILY_LIMIT_EXCEEDED));
    }

    /// @dev Oscillation across midnight must not multiply the limit.
    function test_timestampOscillation_cannotMultiplyLimit() public {
        uint256 paid;
        for (uint256 i = 0; i < 6; ++i) {
            vm.warp(i % 2 == 0 ? midnight + 3 : midnight - 3);
            vm.prank(agent);
            try vault.pay(address(usdc), service, DAILY_LIMIT, keccak256(abi.encode(i))) {
                paid += DAILY_LIMIT;
            } catch {}
        }
        // At most: one full limit in day D-1 (if the first payment landed
        // there) plus one in day D. Never more, however many times it flips.
        assertLe(paid, 2 * uint256(DAILY_LIMIT), "oscillation multiplied the limit");
        assertEq(usdc.balanceOf(service), paid);
    }

    /// @dev Documents, rather than hides, the calendar-bucket property: up to
    ///      2x dailyLimit can move in seconds when straddling midnight UTC.
    function test_calendarBoundary_allowsTwoLimitsAcrossMidnight() public {
        vm.warp(midnight - 2);
        vm.prank(agent);
        vault.pay(address(usdc), service, DAILY_LIMIT, keccak256("before"));

        vm.warp(midnight + 2);
        vm.prank(agent);
        vault.pay(address(usdc), service, DAILY_LIMIT, keccak256("after"));

        assertEq(usdc.balanceOf(service), 2 * uint256(DAILY_LIMIT));

        // ...but never a third within that new day.
        vm.prank(agent);
        vm.expectRevert(
            abi.encodeWithSelector(IAgentVault.DailyLimitExceeded.selector, uint256(1), uint128(0))
        );
        vault.pay(address(usdc), service, 1, keccak256("third"));
    }
}
