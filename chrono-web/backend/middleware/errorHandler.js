export function errorHandler(err, req, res, next) {
  console.error('Error:', err.message);
  if (err.stack) {
    console.error(err.stack);
  }

  const status = err.status || 500;
  res.status(status).json({
    error: err.message || 'Internal Server Error',
    details: process.env.NODE_ENV === 'development' ? err.stack : undefined
  });
}
