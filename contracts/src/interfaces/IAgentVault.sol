// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

/// @title IAgentVault
/// @notice Types, events, errors and the external surface of AgentVault.
///
/// @dev DESIGN CONTRACT — the whole project rests on this:
///
///      The vault has exactly two authorities.
///
///        owner       — the human. May fund, withdraw, author policy, create and
///                      revoke sessions. Root of trust.
///        session key — the AI agent. May call exactly one function, `pay`, and
///                      only within the policy the owner signed.
///
///      There is no third authority, no upgrade path, and no function by which a
///      session key can widen its own policy. An agent that is fully compromised
///      — prompt, process and private key — still cannot exceed `maxPerTx`,
///      `dailyLimit`, `expiresAt`, or the recipient allowlist.
///
///      AI proposes. Code disposes.
///
/// @dev DECIMALS — every amount in this interface is denominated in the USDC
///      ERC-20 interface's 6 decimals, NOT the 18 decimals Arc uses for native
///      USDC gas. 1 USDC == 1_000_000. Mixing the two is a 10^12x error and is
///      tracked as threat T-12 in docs/ARCHITECTURE.md.
interface IAgentVault {
    // -------------------------------------------------------------------------
    // Types
    // -------------------------------------------------------------------------

    /// @notice Why a payment was (or would be) refused.
    /// @dev Mirrored exactly by `RejectionReason` in packages/shared/src/types.ts
    ///      and by the custom errors below. Order is part of the ABI — append
    ///      only, never reorder.
    enum RejectionReason {
        NONE,
        SESSION_UNKNOWN,
        SESSION_REVOKED,
        SESSION_EXPIRED,
        RECIPIENT_NOT_ALLOWED,
        EXCEEDS_MAX_PER_TX,
        EXCEEDS_DAILY_LIMIT,
        INSUFFICIENT_BALANCE,
        ZERO_AMOUNT
    }

    /// @notice A session key's complete on-chain authority.
    /// @param maxPerTx       Ceiling on a single payment, 6dp USDC.
    /// @param dailyLimit     Ceiling on cumulative spend within one day window.
    /// @param expiresAt      Unix seconds. Session fails closed after this.
    /// @param windowDay      Current accounting day (`block.timestamp / 1 days`).
    /// @param spentInWindow  Spend recorded so far in `windowDay`.
    /// @param revoked        Owner kill switch. One-way.
    /// @param exists         Distinguishes "never created" from "all zeroes".
    struct Session {
        uint128 maxPerTx;
        uint128 dailyLimit;
        uint64 expiresAt;
        uint64 windowDay;
        uint128 spentInWindow;
        bool revoked;
        bool exists;
    }

    /// @notice A payment the agent proposes. Reserved for the phase-2 relayer
    ///         path; see `payWithIntent`.
    struct PaymentIntent {
        address vault;
        address sessionKey;
        address to;
        uint256 amount;
        bytes32 intentHash;
        uint256 nonce;
        uint64 deadline;
    }

    // -------------------------------------------------------------------------
    // Events
    // -------------------------------------------------------------------------

    event Deposited(address indexed from, uint256 amount);
    event Withdrawn(address indexed to, uint256 amount);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    event SessionCreated(
        address indexed sessionKey, uint128 maxPerTx, uint128 dailyLimit, uint64 expiresAt
    );
    event SessionPolicyUpdated(
        address indexed sessionKey, uint128 maxPerTx, uint128 dailyLimit, uint64 expiresAt
    );
    event SessionRevoked(address indexed sessionKey);
    event RecipientSet(address indexed sessionKey, address indexed recipient, bool allowed);

    /// @notice A payment that passed every policy check and settled.
    /// @dev This is the event third parties verify against. `intentHash` binds
    ///      the payment to an off-chain invoice so a service can prove which
    ///      obligation was discharged.
    event PaymentExecuted(
        address indexed sessionKey,
        address indexed to,
        uint256 amount,
        bytes32 indexed intentHash,
        uint128 spentInWindow
    );

    // -------------------------------------------------------------------------
    // Errors — one per rejection reason, so the agent can decode *why*
    // -------------------------------------------------------------------------

    error NotOwner();
    error NotSessionKey();
    error SessionUnknown();
    error SessionRevoked_();
    error SessionExpired();
    error RecipientNotAllowed(address attempted);
    error ExceedsMaxPerTx(uint256 attempted, uint128 maxPerTx);
    error ExceedsDailyLimit(uint256 attempted, uint128 remaining);
    error InsufficientBalance(uint256 attempted, uint256 balance);
    error ZeroAmount();
    error ZeroAddress();
    error InvalidExpiry();
    error TransferFailed();
    error NotImplemented();

    // -------------------------------------------------------------------------
    // Funding — owner
    // -------------------------------------------------------------------------

    /// @notice Pull `amount` of USDC from the caller into the vault.
    /// @dev Caller must `approve` the vault first.
    function deposit(uint256 amount) external;

    /// @notice Owner-only, unconditional exit. The human is never locked out.
    function withdraw(address to, uint256 amount) external;

    // -------------------------------------------------------------------------
    // Policy administration — owner only, always
    // -------------------------------------------------------------------------

    function createSession(
        address sessionKey,
        uint128 maxPerTx,
        uint128 dailyLimit,
        uint64 expiresAt,
        address[] calldata recipients
    ) external;

    function updateSessionPolicy(
        address sessionKey,
        uint128 maxPerTx,
        uint128 dailyLimit,
        uint64 expiresAt
    ) external;

    /// @notice The kill switch. One-way: a revoked key can never be reinstated.
    function revokeSession(address sessionKey) external;

    function setRecipient(address sessionKey, address recipient, bool allowed) external;

    function transferOwnership(address newOwner) external;

    // -------------------------------------------------------------------------
    // Payment — session key only
    // -------------------------------------------------------------------------

    /// @notice The agent's entire capability surface.
    /// @dev Reverts with the specific custom error naming the first failed check.
    ///      MVP authority model: msg.sender is a restricted EOA session key.
    /// @param to          Recipient. Must be on this session's allowlist.
    /// @param amount      6dp USDC.
    /// @param intentHash  Binds this payment to an off-chain invoice. Opaque here.
    function pay(address to, uint256 amount, bytes32 intentHash) external;

    /// @notice PHASE 2 — relayer-submitted, signature-authorised payment.
    /// @dev Reverts `NotImplemented` in the MVP. Declared now so the migration to
    ///      EIP-712 signed intents (and then ERC-4337 session keys) is additive:
    ///      the policy logic, the events and the frontend do not change, only who
    ///      submits the transaction and how authority is proven. The MVP does not
    ///      claim to be ERC-4337.
    function payWithIntent(PaymentIntent calldata intent, bytes calldata signature) external;

    // -------------------------------------------------------------------------
    // Views
    // -------------------------------------------------------------------------

    function owner() external view returns (address);
    function usdc() external view returns (address);
    function balance() external view returns (uint256);
    function getSession(address sessionKey) external view returns (Session memory);
    function isRecipientAllowed(address sessionKey, address recipient) external view returns (bool);

    /// @notice Spend still available to `sessionKey` in the current day window.
    function remainingDailyAllowance(address sessionKey) external view returns (uint256);

    /// @notice Run the exact `pay` check sequence without spending gas.
    /// @dev A convenience for the UI and for the agent, never a grant of
    ///      authority: `pay` re-checks everything independently. A preview that
    ///      returns `true` authorises nothing.
    function previewPay(address sessionKey, address to, uint256 amount)
        external
        view
        returns (bool allowed, RejectionReason reason);
}
