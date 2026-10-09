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
///                      revoke sessions, and freeze the vault. Root of trust.
///        session key — the AI agent. May call exactly one function, `pay`, and
///                      only within the policy the owner signed.
///
///      There is no third authority, no upgrade path, and no function by which a
///      session key can widen its own policy. An agent that is fully compromised
///      — prompt, process and private key — still cannot exceed `maxPerTx`,
///      `dailyLimit`, `expiresAt`, or the recipient allowlist.
///
///      The agent only ever REQUESTS: (token, recipient, amount). This contract
///      independently decides. AI proposes. Code disposes.
///
/// @dev DECIMALS — every amount in this interface is denominated in the USDC
///      ERC-20 interface's 6 decimals, NOT the 18 decimals Arc uses for native
///      USDC gas. 1 USDC == 1_000_000. Mixing the two is a 10^12x error and is
///      tracked as threat T-12 in docs/ARCHITECTURE.md.
interface IAgentVault {
    // -------------------------------------------------------------------------
    // Types
    // -------------------------------------------------------------------------

    /// @notice Why a payment was, or would be, refused.
    /// @dev Mirrored exactly by `RejectionReason` in packages/shared/src/types.ts
    ///      and one-to-one with the custom errors below. Order is part of the
    ///      ABI — append only, never reorder.
    enum RejectionReason {
        NONE,
        VAULT_PAUSED,
        UNAUTHORIZED_AGENT,
        SESSION_REVOKED,
        SESSION_EXPIRED,
        INVALID_TOKEN,
        RECIPIENT_NOT_ALLOWED,
        ZERO_AMOUNT,
        EXCEEDS_MAX_PER_TX,
        DAILY_LIMIT_EXCEEDED,
        INSUFFICIENT_BALANCE
    }

    /// @notice A session key's complete on-chain authority.
    /// @param maxPerTx       Ceiling on a single payment, 6dp USDC.
    /// @param dailyLimit     Ceiling on cumulative spend within one day window.
    /// @param expiresAt      Unix seconds. Session fails closed at/after this.
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
        address token;
        address to;
        uint256 amount;
        bytes32 intentHash;
        uint256 nonce;
        uint64 deadline;
    }

    // -------------------------------------------------------------------------
    // Events
    //
    // Indexed fields are chosen for the frontend's access patterns: filter the
    // ledger by session key or by recipient, and look a payment up by the
    // invoice it settles.
    // -------------------------------------------------------------------------

    event Deposited(address indexed from, uint256 amount);
    event Withdrawn(address indexed to, uint256 amount);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event PauseSet(bool paused);

    event SessionCreated(
        address indexed sessionKey, uint128 maxPerTx, uint128 dailyLimit, uint64 expiresAt
    );
    event PolicyUpdated(
        address indexed sessionKey, uint128 maxPerTx, uint128 dailyLimit, uint64 expiresAt
    );
    event SessionRevoked(address indexed sessionKey);
    event RecipientUpdated(address indexed sessionKey, address indexed recipient, bool allowed);

    /// @notice A payment that passed every policy check and settled.
    ///
    /// @dev This is the event third parties verify against, and the only
    ///      settlement signal the system produces. `intentHash` binds the
    ///      payment to an off-chain invoice so a service can prove which
    ///      obligation was discharged.
    ///
    ///      NOTE ON THE ABSENCE OF A `PaymentRejected` EVENT: a refused payment
    ///      reverts, and a reverted transaction's logs are discarded — so no
    ///      such event could ever be observed. Rejections are surfaced two other
    ///      ways instead: `previewPay` returns a deterministic `RejectionReason`
    ///      without spending gas, and a reverted `pay` returns a specific custom
    ///      error whose 4-byte selector the backend decodes. See the errors
    ///      below.
    event PaymentExecuted(
        address indexed sessionKey,
        address indexed to,
        address token,
        uint256 amount,
        bytes32 indexed intentHash,
        uint128 spentInWindow
    );

    // -------------------------------------------------------------------------
    // Errors — one per rejection reason, so the agent can decode exactly WHY.
    //
    // These selectors are the machine-readable rejection interface. Renaming one
    // changes its selector and breaks decoding, so treat them as ABI.
    // -------------------------------------------------------------------------

    /// @dev Caller is not a registered session key on this vault.
    error UnauthorizedAgent(address caller);
    /// @dev Named `SessionIsRevoked`, not `SessionRevoked`, only because Solidity
    ///      will not allow an error and an event to share an identifier, and the
    ///      event name is the one the indexer depends on.
    error SessionIsRevoked();
    error SessionExpired(uint64 expiredAt, uint256 nowTs);
    error InvalidToken(address attempted, address expected);
    error RecipientNotAllowed(address attempted);
    error ExceedsMaxPerTx(uint256 attempted, uint128 maxPerTx);
    error DailyLimitExceeded(uint256 attempted, uint128 remaining);
    error InsufficientBalance(uint256 attempted, uint256 balance);
    error VaultPaused();

    // Administrative / input errors
    error NotOwner();
    error ZeroAmount();
    error ZeroAddress();
    error InvalidExpiry();
    error SessionAlreadyExists();
    error TransferFailed();
    error NotImplemented();

    // -------------------------------------------------------------------------
    // Funding
    // -------------------------------------------------------------------------

    /// @notice Pull `amount` of USDC from the caller into the vault.
    /// @dev Caller must `approve` the vault first. Permissionless: anyone may
    ///      top a vault up, but only the owner can ever take funds out.
    function deposit(uint256 amount) external;

    /// @notice Owner-only, unconditional exit. The human is never locked out —
    ///         not by a policy, not by a pause, not by an active session.
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

    function updatePolicy(
        address sessionKey,
        uint128 maxPerTx,
        uint128 dailyLimit,
        uint64 expiresAt
    ) external;

    /// @notice The per-session kill switch. One-way: a revoked key can never be
    ///         reinstated, so an operator reacting to a suspected compromise
    ///         gets a guarantee rather than a pause.
    function revokeSession(address sessionKey) external;

    function setRecipient(address sessionKey, address recipient, bool allowed) external;

    /// @notice Batch form of `setRecipient`, for authoring a policy in one tx.
    function setRecipients(address sessionKey, address[] calldata recipients, bool allowed) external;

    /// @notice Global freeze. Halts every session's spending at once, and is
    ///         reversible — distinct from `revokeSession`, which is permanent
    ///         and scoped to one key. Never blocks owner withdrawal.
    function setPaused(bool paused) external;

    function transferOwnership(address newOwner) external;

    // -------------------------------------------------------------------------
    // Payment — session key only
    // -------------------------------------------------------------------------

    /// @notice The agent's entire capability surface: request (token, to, amount).
    ///
    /// @dev Reverts with the specific custom error naming the first failed check.
    ///      MVP authority model: msg.sender is a restricted EOA session key.
    ///
    /// @param token       Must equal the vault's configured USDC, else
    ///                    `InvalidToken`. Present so the agent's request is
    ///                    explicit and so multi-token support is additive.
    /// @param to          Recipient. Must be on this session's allowlist.
    /// @param amount      6dp USDC.
    /// @param intentHash  Binds this payment to an off-chain invoice. Opaque here.
    function pay(address token, address to, uint256 amount, bytes32 intentHash) external;

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
    function paused() external view returns (bool);
    function balance() external view returns (uint256);
    function getSession(address sessionKey) external view returns (Session memory);
    function isRecipientAllowed(address sessionKey, address recipient) external view returns (bool);

    /// @notice Spend still available to `sessionKey` in the current day window.
    /// @dev Returns 0 for any session that cannot spend at all, so a caller
    ///      cannot read a non-zero allowance for a revoked or expired session.
    function remainingDailyAllowance(address sessionKey) external view returns (uint256);

    /// @notice Run the exact `pay` check sequence without spending gas.
    ///
    /// @dev This is how a rejection becomes observable without a transaction:
    ///      the UI renders the reason, and the agent avoids burning gas on a
    ///      doomed attempt. It is a convenience, never a grant of authority —
    ///      `pay` re-checks everything independently, so a preview returning
    ///      `true` authorises nothing.
    function previewPay(address sessionKey, address token, address to, uint256 amount)
        external
        view
        returns (bool allowed, RejectionReason reason);
}
