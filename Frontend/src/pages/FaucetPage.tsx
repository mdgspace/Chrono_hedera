import { Box, Typography } from '@mui/material';

export const FaucetPage = () => {
  return (
    <Box sx={{ p: 4 }}>
      <Typography variant="h2" gutterBottom>
        Testnet Faucet
      </Typography>
      <Typography variant="body1">
        Mint testnet wETH and wUSDC to your wallet.
      </Typography>
    </Box>
  );
};
