# Issue #7 PR 2: D* partial-liquidation sizing, dynamic bonus beta(HF), HF 0.85 Stability Pool cutoff.
# Render from the repo root: nix-shell -p vhs --run 'vhs demo/issue-7-liquidation-routing-p1.tape'
Output demo/issue-7-liquidation-routing-p1.gif

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

Type "npx hardhat test test/MathLib.test.ts test/RiskEngine.test.ts test/LiquidationEngine.test.ts test/integration/HardLiquidationWaterfall.test.ts --grep 'D[*]|0[.]85|dynamicBonus|computeDStar|liquidation threshold|[Ww]atermark'"
Sleep 300ms
Enter
Wait+Screen@60s /passing/
Sleep 5s
