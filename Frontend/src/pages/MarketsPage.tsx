import React from 'react';
import { Box, Typography } from '@mui/material';

export const MarketsPage = () => {
  return (
    <Box sx={{ p: 4 }}>
      <Typography variant="h2" gutterBottom>
        Markets
      </Typography>
      <Typography variant="body1">
        Deposit collateral, borrow debt, and view duration-bound LTV.
      </Typography>
    </Box>
  );
};
