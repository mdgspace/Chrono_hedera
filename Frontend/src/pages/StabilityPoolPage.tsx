import { Box, Typography } from '@mui/material';

export const StabilityPoolPage = () => {
  return (
    <Box sx={{ p: 4 }}>
      <Typography variant="h2" gutterBottom>
        Stability Pool
      </Typography>
      <Typography variant="body1">
        Deposit wUSDC to absorb debt and earn liquidation bonuses.
      </Typography>
    </Box>
  );
};
