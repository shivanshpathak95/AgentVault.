// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {MockUSDC} from "./MockUSDC.sol";

/// @notice A 6-decimal token that can be made to return `false` instead of
///         reverting on transfer.
///
/// @dev Models the classic ERC-20 footgun: a token that signals failure by
///      return value. A vault that ignored the boolean would emit a settlement
///      event and credit a daily budget for a transfer that never happened —
///      which, because apps/service settles invoices from those events, would
///      let an agent obtain goods without paying.
contract FailingUSDC is MockUSDC {
    bool public failTransfers;
    bool public failTransferFroms;

    function setFailTransfers(bool v) external {
        failTransfers = v;
    }

    function setFailTransferFroms(bool v) external {
        failTransferFroms = v;
    }

    function transfer(address to, uint256 amount) public override returns (bool) {
        if (failTransfers) return false;
        return super.transfer(to, amount);
    }

    function transferFrom(address from, address to, uint256 amount) public override returns (bool) {
        if (failTransferFroms) return false;
        return super.transferFrom(from, to, amount);
    }
}
