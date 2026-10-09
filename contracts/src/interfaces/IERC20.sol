// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

/// @notice Minimal ERC-20 surface.
/// @dev On Arc this is the USDC *ERC-20 interface* (6 decimals), which is a
///      different view of the same asset as native USDC (18 decimals). The
///      vault uses this interface exclusively; see IAgentVault for why.
interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function approve(address spender, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
    function allowance(address owner, address spender) external view returns (uint256);
    function decimals() external view returns (uint8);
}
