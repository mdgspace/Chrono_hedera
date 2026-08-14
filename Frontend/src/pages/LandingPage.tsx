import { Box, Typography, Button } from '@mui/material';

export const LandingPage = () => {
  return (
    <Box sx={{ p: 4, minHeight: '100vh', bgcolor: 'obsidian' }}>
      <Typography variant="h1" gutterBottom>
        Chrono Protocol
      </Typography>
      <Typography variant="body1" sx={{ mb: 4 }}>
        Fixed-term, duration-bound borrowing with dynamic LTV.
      </Typography>
      <Button variant="contained" color="primary" href="/dashboard">
        Launch App
      </Button>
    </Box>
  );
};
