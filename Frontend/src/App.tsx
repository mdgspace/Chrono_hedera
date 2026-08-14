import React from 'react';
import { BrowserRouter, Routes, Route, Link } from 'react-router-dom';
import { ThemeProvider } from '@mui/material/styles';
import CssBaseline from '@mui/material/CssBaseline';
import { WagmiProvider } from 'wagmi';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RainbowKitProvider, darkTheme } from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';

import { chronoTheme } from './theme/mui-theme';
import { wagmiConfig } from './config/wagmi';

import { LandingPage } from './pages/LandingPage';
import { DashboardPage } from './pages/DashboardPage';
import { FaucetPage } from './pages/FaucetPage';
import { MarketsPage } from './pages/MarketsPage';
import { StabilityPoolPage } from './pages/StabilityPoolPage';
import { tokens } from './theme/tokens';
import { AppBar, Toolbar, Button, Box, Typography } from '@mui/material';
import { ConnectButton } from '@rainbow-me/rainbowkit';

const queryClient = new QueryClient();

const Navigation = () => (
  <AppBar position="static" color="transparent" elevation={0} sx={{ borderBottom: `1px solid ${tokens.colors.slate[700]}` }}>
    <Toolbar>
      <Typography variant="h6" component={Link} to="/" sx={{ flexGrow: 1, textDecoration: 'none', color: 'inherit', fontWeight: 'bold' }}>
        Chrono
      </Typography>
      <Box sx={{ display: 'flex', gap: 2, alignItems: 'center' }}>
        <Button color="inherit" component={Link} to="/dashboard">Dashboard</Button>
        <Button color="inherit" component={Link} to="/markets">Markets</Button>
        <Button color="inherit" component={Link} to="/stability-pool">Stability Pool</Button>
        <Button color="inherit" component={Link} to="/faucet">Faucet</Button>
        <ConnectButton />
      </Box>
    </Toolbar>
  </AppBar>
);

function App() {
  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider theme={darkTheme({ accentColor: tokens.colors.emerald[500] })}>
          <ThemeProvider theme={chronoTheme}>
            <CssBaseline />
            <BrowserRouter>
              <Navigation />
              <Routes>
                <Route path="/" element={<LandingPage />} />
                <Route path="/dashboard" element={<DashboardPage />} />
                <Route path="/markets" element={<MarketsPage />} />
                <Route path="/stability-pool" element={<StabilityPoolPage />} />
                <Route path="/faucet" element={<FaucetPage />} />
              </Routes>
            </BrowserRouter>
          </ThemeProvider>
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}

export default App;
