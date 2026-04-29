const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');

const app = express();
const PORT = 3005;

// Log incoming requests
app.use((req, res, next) => {
  console.log(`[Gateway Proxy] ${req.method} ${req.url}`);
  next();
});

// Route /customers to port 3001
app.use('/customers', createProxyMiddleware({
  target: 'http://localhost:3001',
  changeOrigin: true,
  onProxyReq: (proxyReq, req, res) => {
    console.log(`[Gateway Proxy] Forwarding to Customers API -> ${req.method} ${proxyReq.path}`);
  }
}));

// Route /orders to port 3002
app.use('/orders', createProxyMiddleware({
  target: 'http://localhost:3002',
  changeOrigin: true,
  onProxyReq: (proxyReq, req, res) => {
    console.log(`[Gateway Proxy] Forwarding to Orders API -> ${req.method} ${proxyReq.path}`);
  }
}));

app.listen(PORT, () => {
  console.log(`====================================================`);
  console.log(`🚀 Unified Gateway Proxy listening on port ${PORT}`);
  console.log(`👉 http://localhost:${PORT}/customers -> localhost:3001/customers`);
  console.log(`👉 http://localhost:${PORT}/orders    -> localhost:3002/orders`);
  console.log(`====================================================`);
});

