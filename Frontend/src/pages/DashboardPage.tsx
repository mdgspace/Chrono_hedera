import { Box, Typography } from '@mui/material';

export const DashboardPage = () => {
  return (
    <Box sx={{ p: 4 }}>
      <Typography variant="h2" gutterBottom>
        Dashboard
      </Typography>
      <Typography variant="body1">
        Manage your active positions and Health Factor.
      </Typography>
    </Box>
  );
};
