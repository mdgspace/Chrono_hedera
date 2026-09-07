import express from 'express';
import cors from 'cors';
import { config } from './config/index.js';
import { errorHandler } from './middleware/errorHandler.js';

import faucetRoutes from './routes/faucet.js';
import marketsRoutes from './routes/markets.js';
import liquidationsRoutes from './routes/liquidations.js';
import protocolRoutes from './routes/protocol.js';
import poolRoutes from './routes/pool.js';
import stabilityPoolRoutes from './routes/stabilityPool.js';

import { startIndexer } from './services/liquidationIndexer.js';
import { startSnapshotter } from './services/tvlSnapshotter.js';
import { startPositionIndexer } from './services/positionIndexer.js';

const app = express();

app.use(cors());
app.use(express.json());

// Health Check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Mount Routes
app.use('/api/v1/faucet', faucetRoutes);
app.use('/api/v1/markets', marketsRoutes);
app.use('/api/v1/liquidations', liquidationsRoutes);
app.use('/api/v1/protocol', protocolRoutes);
app.use('/api/v1/pool/stability', stabilityPoolRoutes);
app.use('/api/v1/pool', poolRoutes);

// Error Middleware
app.use(errorHandler);

app.listen(config.PORT, () => {
  console.log(`Chrono Backend running on port ${config.PORT}`);
  
  // Start background services
  startIndexer();
  startSnapshotter();
  startPositionIndexer();
});
