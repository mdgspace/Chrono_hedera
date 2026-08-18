export function getVolatility(asset) {
  const config = {
    wETH: 0.45,
    wBTC: 0.40,
    wUSDC: 0.01
  };

  const sigma30d = config[asset] || 0.50; // Default fallback

  return {
    asset,
    sigma30d,
    source: "hardcoded",
    note: "MVP placeholder — replace with real computation"
  };
}
