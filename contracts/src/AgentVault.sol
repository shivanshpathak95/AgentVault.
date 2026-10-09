// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {IAgentVault} from "./interfaces/IAgentVault.sol";
import {IERC20} from "./interfaces/IERC20.sol";

/// @title AgentVault
/// @notice A policy-controlled USDC wallet for an autonomous AI agent.
///
/// @dev This contract is the only security authority in AgentVault. No model, no
///      backend and no frontend participates in the decision to release funds.
///      See IAgentVault for the full design contract and docs/ARCHITECTURE.md
///      for the threat model.
///
///      All amounts are 6dp USDC (the Arc ERC-20 interface), never the 18dp
///      native representation used for gas.
///
/// @custom:security-contact see README
contract AgentVault is IAgentVault {
    // -------------------------------------------------------------------------
    // Immutable / storage
    // -------------------------------------------------------------------------

    /// @notice The USDC ERC-20 interface. Immutable: a vault cannot be retargeted
    ///         at a different token after the operator has funded it.
    IERC20 public immutable USDC;

    address private _owner;

    mapping(address sessionKey => Session) private _sessions;
    mapping(address sessionKey => mapping(address recipient => bool)) private _allowedRecipients;

    // -------------------------------------------------------------------------
    // Modifiers
    // -------------------------------------------------------------------------

    modifier onlyOwner() {
        if (msg.sender != _owner) revert NotOwner();
        _;
    }

    // -------------------------------------------------------------------------
    // Construction
    // -------------------------------------------------------------------------

    constructor(address owner_, address usdc_) {
        if (owner_ == address(0) || usdc_ == address(0)) revert ZeroAddress();
        _owner = owner_;
        USDC = IERC20(usdc_);
        emit OwnershipTransferred(address(0), owner_);
    }

    // -------------------------------------------------------------------------
    // Funding
    // -------------------------------------------------------------------------

    /// @inheritdoc IAgentVault
    function deposit(uint256 amount) external {
        if (amount == 0) revert ZeroAmount();
        emit Deposited(msg.sender, amount); // pre-interaction; see the note in pay()
        if (!USDC.transferFrom(msg.sender, address(this), amount)) revert TransferFailed();
    }

    /// @inheritdoc IAgentVault
    /// @dev Unconditional and owner-only. There is no policy, timelock or agent
    ///      consent on the human's exit path, by design.
    function withdraw(address to, uint256 amount) external onlyOwner {
        if (to == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();
        emit Withdrawn(to, amount); // pre-interaction; see the note in pay()
        if (!USDC.transfer(to, amount)) revert TransferFailed();
    }

    // -------------------------------------------------------------------------
    // Policy administration — owner only
    // -------------------------------------------------------------------------

    /// @inheritdoc IAgentVault
    function createSession(
        address sessionKey,
        uint128 maxPerTx,
        uint128 dailyLimit,
        uint64 expiresAt,
        address[] calldata recipients
    ) external onlyOwner {
        if (sessionKey == address(0)) revert ZeroAddress();
        if (expiresAt <= block.timestamp) revert InvalidExpiry();

        Session storage s = _sessions[sessionKey];

        // A revoked key is permanently dead. Allowing re-creation would turn the
        // kill switch into a pause button and break the guarantee an operator
        // relies on after a suspected compromise.
        if (s.revoked) revert SessionRevoked_();

        s.maxPerTx = maxPerTx;
        s.dailyLimit = dailyLimit;
        s.expiresAt = expiresAt;
        s.windowDay = uint64(block.timestamp / 1 days);
        s.spentInWindow = 0;
        s.exists = true;

        emit SessionCreated(sessionKey, maxPerTx, dailyLimit, expiresAt);

        uint256 len = recipients.length;
        for (uint256 i = 0; i < len; ++i) {
            address r = recipients[i];
            if (r == address(0)) revert ZeroAddress();
            // forge-lint: disable-next-line(missing-events-access-control)
            _allowedRecipients[sessionKey][r] = true;
            emit RecipientSet(sessionKey, r, true); // <- the event the lint wants
        }
    }

    /// @inheritdoc IAgentVault
    /// @dev Does not reset `spentInWindow`: tightening a limit mid-day must not
    ///      hand the agent a fresh allowance.
    function updateSessionPolicy(
        address sessionKey,
        uint128 maxPerTx,
        uint128 dailyLimit,
        uint64 expiresAt
    ) external onlyOwner {
        Session storage s = _sessions[sessionKey];
        if (!s.exists) revert SessionUnknown();
        if (s.revoked) revert SessionRevoked_();
        if (expiresAt <= block.timestamp) revert InvalidExpiry();

        s.maxPerTx = maxPerTx;
        s.dailyLimit = dailyLimit;
        s.expiresAt = expiresAt;

        emit SessionPolicyUpdated(sessionKey, maxPerTx, dailyLimit, expiresAt);
    }

    /// @inheritdoc IAgentVault
    function revokeSession(address sessionKey) external onlyOwner {
        Session storage s = _sessions[sessionKey];
        if (!s.exists) revert SessionUnknown();
        s.revoked = true;
        emit SessionRevoked(sessionKey);
    }

    /// @inheritdoc IAgentVault
    function setRecipient(address sessionKey, address recipient, bool allowed) external onlyOwner {
        if (recipient == address(0)) revert ZeroAddress();
        if (!_sessions[sessionKey].exists) revert SessionUnknown();
        // forge-lint: disable-next-line(missing-events-access-control)
        _allowedRecipients[sessionKey][recipient] = allowed;
        emit RecipientSet(sessionKey, recipient, allowed); // <- the event the lint wants
    }

    /// @inheritdoc IAgentVault
    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert ZeroAddress();
        address prev = _owner;
        _owner = newOwner;
        emit OwnershipTransferred(prev, newOwner);
    }

    // -------------------------------------------------------------------------
    // Payment — the enforcement path
    // -------------------------------------------------------------------------

    /// @inheritdoc IAgentVault
    /// @dev Checks run in the order below so the revert names the policy the
    ///      caller actually violated, rather than an incidental one. The agent
    ///      decodes this error and reports the real reason to its operator.
    ///
    ///      Follows checks-effects-interactions: the daily window is written
    ///      before the transfer, so a hostile token cannot re-enter and spend the
    ///      same allowance twice.
    function pay(address to, uint256 amount, bytes32 intentHash) external {
        Session storage s = _sessions[msg.sender];

        // 1. Is this a session key at all?
        if (!s.exists) revert SessionUnknown();
        // 2. Has the operator killed it?
        if (s.revoked) revert SessionRevoked_();
        // 3. Has it aged out? Sessions fail closed with no operator action.
        if (block.timestamp >= s.expiresAt) revert SessionExpired();
        // 4. Is the recipient one the human named?
        if (!_allowedRecipients[msg.sender][to]) revert RecipientNotAllowed(to);
        // 5. Single-payment ceiling.
        if (amount == 0) revert ZeroAmount();
        if (amount > s.maxPerTx) revert ExceedsMaxPerTx(amount, s.maxPerTx);

        // 6. Daily ceiling, against a freshly rolled window.
        uint64 today = uint64(block.timestamp / 1 days);
        uint128 spent = s.windowDay == today ? s.spentInWindow : 0;
        uint128 remaining = s.dailyLimit > spent ? s.dailyLimit - spent : 0;
        if (amount > remaining) revert ExceedsDailyLimit(amount, remaining);

        // 7. Can we actually pay it?
        uint256 bal = USDC.balanceOf(address(this));
        if (amount > bal) revert InsufficientBalance(amount, bal);

        // Effects — including the event.
        //
        // The event is emitted BEFORE the transfer on purpose. apps/service
        // settles invoices by reading PaymentExecuted logs, so their integrity is
        // load-bearing for a third party that trusts neither the agent nor the
        // frontend. Emitting pre-interaction means no external call can sit
        // between the state update and the log and reorder or interleave them.
        // Soundness: if the transfer below reverts or returns false, the whole
        // transaction reverts and this log is discarded with it — a surviving
        // PaymentExecuted always implies a completed transfer.
        uint128 newSpent = spent + uint128(amount);
        s.windowDay = today;
        s.spentInWindow = newSpent;
        emit PaymentExecuted(msg.sender, to, amount, intentHash, newSpent);

        // Interaction
        if (!USDC.transfer(to, amount)) revert TransferFailed();
    }

    /// @inheritdoc IAgentVault
    /// @dev PHASE 2. Intentionally unimplemented — the MVP's authority model is a
    ///      restricted EOA session key, and this project does not claim to be
    ///      ERC-4337. The signature is declared here so the relayer path can be
    ///      added without touching policy logic, events or the frontend.
    function payWithIntent(PaymentIntent calldata, bytes calldata) external pure {
        revert NotImplemented();
    }

    // -------------------------------------------------------------------------
    // Views
    // -------------------------------------------------------------------------

    function owner() external view returns (address) {
        return _owner;
    }

    function usdc() external view returns (address) {
        return address(USDC);
    }

    function balance() external view returns (uint256) {
        return USDC.balanceOf(address(this));
    }

    function getSession(address sessionKey) external view returns (Session memory) {
        return _sessions[sessionKey];
    }

    function isRecipientAllowed(address sessionKey, address recipient)
        external
        view
        returns (bool)
    {
        return _allowedRecipients[sessionKey][recipient];
    }

    /// @inheritdoc IAgentVault
    function remainingDailyAllowance(address sessionKey) public view returns (uint256) {
        Session storage s = _sessions[sessionKey];
        if (!s.exists || s.revoked || block.timestamp >= s.expiresAt) return 0;
        uint128 spent = s.windowDay == uint64(block.timestamp / 1 days) ? s.spentInWindow : 0;
        return s.dailyLimit > spent ? s.dailyLimit - spent : 0;
    }

    /// @inheritdoc IAgentVault
    /// @dev Mirrors `pay`'s check sequence exactly. If these two ever disagree,
    ///      `pay` is correct and this is a bug — the UI may mislead, but money
    ///      cannot move on a preview.
    function previewPay(address sessionKey, address to, uint256 amount)
        external
        view
        returns (bool allowed, RejectionReason reason)
    {
        Session storage s = _sessions[sessionKey];

        if (!s.exists) return (false, RejectionReason.SESSION_UNKNOWN);
        if (s.revoked) return (false, RejectionReason.SESSION_REVOKED);
        if (block.timestamp >= s.expiresAt) return (false, RejectionReason.SESSION_EXPIRED);
        if (!_allowedRecipients[sessionKey][to]) {
            return (false, RejectionReason.RECIPIENT_NOT_ALLOWED);
        }
        if (amount == 0) return (false, RejectionReason.ZERO_AMOUNT);
        if (amount > s.maxPerTx) return (false, RejectionReason.EXCEEDS_MAX_PER_TX);

        uint128 spent = s.windowDay == uint64(block.timestamp / 1 days) ? s.spentInWindow : 0;
        uint128 remaining = s.dailyLimit > spent ? s.dailyLimit - spent : 0;
        if (amount > remaining) return (false, RejectionReason.EXCEEDS_DAILY_LIMIT);

        if (amount > USDC.balanceOf(address(this))) {
            return (false, RejectionReason.INSUFFICIENT_BALANCE);
        }

        return (true, RejectionReason.NONE);
    }
}
