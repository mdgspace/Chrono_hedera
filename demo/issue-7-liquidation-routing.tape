# Issue #7 PR 1: reserve watermark, Dutch auction fallback, partial-liquidation principal fix.
# Render from the repo root: nix-shell -p vhs --run 'vhs demo/issue-7-liquidation-routing.tape'
Output demo/issue-7-liquidation-routing.gif

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

Type "npx hardhat test test/LiquidationEngine.test.ts test/BorrowVault.test.ts test/integration/HardLiquidationWaterfall.test.ts --grep 'auction|Auction|watermark|Watermark|reducePrincipal|principal sync'"
Sleep 300ms
Enter
Wait+Screen@60s /passing/
Sleep 5s
