import express from 'express';
import { supabase } from '../db/supabase.js';

const router = express.Router();

router.get('/history', async (req, res, next) => {
  try {
    const { pool, limit = 50, type } = req.query;

    if (!supabase) {
      return res.status(503).json({ error: 'Database not available' });
    }

    let query = supabase
      .from('liquidation_events')
      .select('*')
      .order('timestamp', { ascending: false })
      .limit(Number(limit));

    if (pool) {
      query = query.eq('pool', pool);
    }
    if (type) {
      query = query.eq('type', type);
    }

    const { data, error } = await query;

    if (error) throw error;
    res.json(data);
  } catch (error) {
    next(error);
  }
});

export default router;
