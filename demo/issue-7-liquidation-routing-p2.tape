# Issue #7 PR 3: linear grace-period late fee ramp, per-asset Dutch auction phase durations.
# Render from the repo root: nix-shell -p vhs --run 'vhs demo/issue-7-liquidation-routing-p2.tape'
Output demo/issue-7-liquidation-routing-p2.gif

Set Shell "bash"
Set FontSize 14
Set Width 1420
Set Height 820
Set Padding 16
Set TypingSpeed 25ms

Hide
Type "export PS1='$ ' HARDHAT_DISABLE_TELEMETRY_PROMPT=true DOTENV_CONFIG_QUIET=true && clear"
Enter
Show

Type "npx hardhat test test/BorrowVault.test.ts test/AssetRegistry.test.ts test/LiquidationEngine.test.ts test/integration/HardLiquidationWaterfall.test.ts --grep 'late fee ramp|ramped late grace fee|auction phase durations|per-asset auction durations'"
Sleep 300ms
Enter
Wait+Screen@60s /passing/
Sleep 5s
