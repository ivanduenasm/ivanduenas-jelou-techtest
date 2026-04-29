/**
 * @file orders-api/src/index.js
 * @description Orders API entry point
 * @author Ivan Dueñas
 */

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const jwt = require('jsonwebtoken');
const { z } = require('zod');
const pool = require('./db');

const app = express();
const JWT_SECRET = process.env.JWT_SECRET || 'operator_super_secret_token';

app.use(cors());
app.use(express.json());

const CUSTOMERS_API_URL = process.env.CUSTOMERS_API_URL || 'http://localhost:3001';
const SERVICE_TOKEN = process.env.SERVICE_TOKEN || 'SUPER_SECRET_SERVICE_TOKEN';

// --- ZOD SCHEMAS ---
const ProductSchema = z.object({
  sku: z.string().min(1),
  name: z.string().min(1),
  price_cents: z.number().int().positive(),
  stock: z.number().int().min(0)
});

const OrderSchema = z.object({
  customer_id: z.number().int().positive(),
  items: z.array(
    z.object({
      product_id: z.number().int().positive(),
      qty: z.number().int().positive()
    })
  ).min(1)
});

// --- AUTH MIDDLEWARE ---
const authenticateJWT = (req, res, next) => {
  const authHeader = req.headers.authorization;
  const token = authHeader && authHeader.split(' ')[1];
  const serviceToken = process.env.SERVICE_TOKEN || 'SUPER_SECRET_SERVICE_TOKEN';

  if (token && token === serviceToken) {
    return next();
  }

  if (token) {
    jwt.verify(token, JWT_SECRET, (err, user) => {
      if (err) return res.status(403).json({ error: 'Forbidden - Invalid JWT' });
      req.user = user;
      next();
    });
  } else {
    res.status(401).json({ error: 'Unauthorized - Missing Token' });
  }
};

// 0. Login route for Operator
app.post('/login', (req, res) => {
  const { username, password } = req.body;
  if (username === 'operator' && password === 'secret123') {
    const token = jwt.sign({ username: 'operator', role: 'admin' }, JWT_SECRET, { expiresIn: '24h' });
    return res.json({ token });
  }
  res.status(401).json({ error: 'Invalid credentials' });
});

// --- HEALTH CHECK ---
app.get('/health', (req, res) => {
  res.json({ status: 'OK', service: 'orders-api' });
});

// --- PRODUCTS ENDPOINTS ---

// POST /products - Create product
app.post('/products', authenticateJWT, async (req, res) => {
  try {
    const validation = ProductSchema.safeParse(req.body);
    if (!validation.success) return res.status(400).json({ error: validation.error.errors });

    const { sku, name, price_cents, stock } = validation.data;
    const [result] = await pool.query(
      'INSERT INTO products (sku, name, price_cents, stock) VALUES (?, ?, ?, ?)',
      [sku, name, price_cents, stock]
    );

    res.status(201).json({ id: result.insertId, sku, name, price_cents, stock });
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'SKU already exists' });
    console.error(error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PATCH /products/:id - Update price/stock
app.patch('/products/:id', authenticateJWT, async (req, res) => {
  try {
    const validation = ProductSchema.partial().safeParse(req.body);
    if (!validation.success) return res.status(400).json({ error: validation.error.errors });

    const updates = validation.data;
    if (Object.keys(updates).length === 0) return res.status(400).json({ error: 'No updates provided' });

    const fields = Object.keys(updates).map(key => `${key} = ?`).join(', ');
    const params = [...Object.values(updates), req.params.id];

    const [result] = await pool.query(`UPDATE products SET ${fields} WHERE id = ?`, params);
    if (result.affectedRows === 0) return res.status(404).json({ error: 'Product not found' });

    res.json({ message: 'Product updated successfully' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /products/:id - Get single product
app.get('/products/:id', authenticateJWT, async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM products WHERE id = ?', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ error: 'Product not found' });
    res.json(rows[0]);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /products - Search & Cursor pagination
app.get('/products', authenticateJWT, async (req, res) => {
  try {
    const { search = '', cursor, limit = 10 } = req.query;
    const parsedLimit = Math.min(parseInt(limit) || 10, 100);
    
    let query = 'SELECT * FROM products WHERE 1=1';
    const params = [];

    if (search) {
      query += ' AND (name LIKE ? OR sku LIKE ?)';
      params.push(`%${search}%`, `%${search}%`);
    }

    if (cursor) {
      query += ' AND id > ?';
      params.push(parseInt(cursor));
    }

    query += ' ORDER BY id ASC LIMIT ?';
    params.push(parsedLimit + 1);

    const [rows] = await pool.query(query, params);

    let nextCursor = null;
    if (rows.length > parsedLimit) {
      const nextItem = rows.pop();
      nextCursor = nextItem.id;
    }

    res.json({ data: rows, nextCursor });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// --- ORDERS ENDPOINTS ---

// POST /orders - Create order (Atomic Transactional stock validation)
app.post('/orders', authenticateJWT, async (req, res) => {
  const validation = OrderSchema.safeParse(req.body);
  if (!validation.success) return res.status(400).json({ error: validation.error.errors });

  const { customer_id, items } = validation.data;

  // 1. Validate Customer via Customers API
  try {
    await axios.get(`${CUSTOMERS_API_URL}/internal/customers/${customer_id}`, {
      headers: { Authorization: `Bearer ${SERVICE_TOKEN}` }
    });
  } catch (error) {
    console.error('Customer Validation Error:', error.message);
    if (error.response && error.response.status === 404) {
      return res.status(404).json({ error: 'Customer not found' });
    }
    return res.status(error.response?.status || 500).json({ error: 'Failed to validate customer with Customers API' });
  }

  // 2. Establish Connection & Start Transaction
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    let total_cents = 0;
    const processedItems = [];

    for (const item of items) {
      // Lock row for stock update to prevent race conditions
      const [products] = await conn.query(
        'SELECT id, price_cents, stock FROM products WHERE id = ? FOR UPDATE',
        [item.product_id]
      );

      if (products.length === 0) throw new Error(`Product ${item.product_id} not found`);

      const product = products[0];
      if (product.stock < item.qty) {
        throw new Error(`Insufficient stock for Product ${item.product_id} (Requested: ${item.qty}, Available: ${product.stock})`);
      }

      const subtotal_cents = product.price_cents * item.qty;
      total_cents += subtotal_cents;

      processedItems.push({
        product_id: item.product_id,
        qty: item.qty,
        unit_price_cents: product.price_cents,
        subtotal_cents
      });

      // Discount stock
      await conn.query('UPDATE products SET stock = stock - ? WHERE id = ?', [item.qty, item.product_id]);
    }

    // Create Order record
    const [orderResult] = await conn.query(
      'INSERT INTO orders (customer_id, status, total_cents) VALUES (?, ?, ?)',
      [customer_id, 'CREATED', total_cents]
    );

    const order_id = orderResult.insertId;

    // Create Order items
    for (const pi of processedItems) {
      await conn.query(
        'INSERT INTO order_items (order_id, product_id, qty, unit_price_cents, subtotal_cents) VALUES (?, ?, ?, ?, ?)',
        [order_id, pi.product_id, pi.qty, pi.unit_price_cents, pi.subtotal_cents]
      );
    }

    await conn.commit();
    res.status(201).json({ id: order_id, customer_id, status: 'CREATED', total_cents, items: processedItems });

  } catch (err) {
    console.error('Create Order Error:', err.message);
    await conn.rollback();
    res.status(400).json({ error: err.message });
  } finally {
    conn.release();
  }
});

// GET /orders/:id - Includes items
app.get('/orders/:id', authenticateJWT, async (req, res) => {
  try {
    const [orders] = await pool.query('SELECT * FROM orders WHERE id = ?', [req.params.id]);
    if (orders.length === 0) return res.status(404).json({ error: 'Order not found' });

    const [items] = await pool.query('SELECT * FROM order_items WHERE order_id = ?', [req.params.id]);
    res.json({ ...orders[0], items });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /orders - Search with cursor & status/date filters
app.get('/orders', authenticateJWT, async (req, res) => {
  try {
    const { status, from, to, cursor, limit = 10 } = req.query;
    const parsedLimit = Math.min(parseInt(limit) || 10, 100);

    let query = 'SELECT * FROM orders WHERE 1=1';
    const params = [];

    if (status) {
      query += ' AND status = ?';
      params.push(status);
    }
    if (from) {
      query += ' AND created_at >= ?';
      params.push(from);
    }
    if (to) {
      query += ' AND created_at <= ?';
      params.push(to);
    }
    if (cursor) {
      query += ' AND id > ?';
      params.push(parseInt(cursor));
    }

    query += ' ORDER BY id ASC LIMIT ?';
    params.push(parsedLimit + 1);

    const [rows] = await pool.query(query, params);

    let nextCursor = null;
    if (rows.length > parsedLimit) {
      const nextItem = rows.pop();
      nextCursor = nextItem.id;
    }

    res.json({ data: rows, nextCursor });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /orders/:id/confirm - Idempotent confirmation
app.post('/orders/:id/confirm', authenticateJWT, async (req, res) => {
  const order_id = req.params.id;
  const idempotencyKey = req.headers['x-idempotency-key'];

  if (!idempotencyKey) {
    return res.status(400).json({ error: 'Missing X-Idempotency-Key header' });
  }

  const conn = await pool.getConnection();
  try {
    const [keys] = await conn.query('SELECT * FROM idempotency_keys WHERE `key` = ?', [idempotencyKey]);
    if (keys.length > 0) {
      return res.json(typeof keys[0].response_body === 'string' ? JSON.parse(keys[0].response_body) : keys[0].response_body);
    }

    await conn.beginTransaction();

    const [orders] = await conn.query('SELECT * FROM orders WHERE id = ? FOR UPDATE', [order_id]);
    if (orders.length === 0) throw new Error('Order not found');

    const order = orders[0];
    if (order.status === 'CANCELED') throw new Error('Cannot confirm a canceled order');

    if (order.status !== 'CONFIRMED') {
      await conn.query('UPDATE orders SET status = ? WHERE id = ?', ['CONFIRMED', order_id]);
      order.status = 'CONFIRMED';
    }

    const [items] = await conn.query('SELECT * FROM order_items WHERE order_id = ?', [order_id]);
    const responseBody = { ...order, items };

    // Save response for idempotency
    await conn.query(
      'INSERT INTO idempotency_keys (`key`, target_type, target_id, status, response_body) VALUES (?, ?, ?, ?, ?)',
      [idempotencyKey, 'order', order_id, 'CONFIRMED', JSON.stringify(responseBody)]
    );

    await conn.commit();
    res.json(responseBody);

  } catch (err) {
    await conn.rollback();
    res.status(400).json({ error: err.message });
  } finally {
    conn.release();
  }
});

// GET /orders/idempotency/:key - Check idempotency
app.get('/orders/idempotency/:key', async (req, res) => {
  try {
    const [keys] = await pool.query('SELECT * FROM idempotency_keys WHERE `key` = ?', [req.params.key]);
    if (keys.length === 0) {
      return res.status(404).json({ error: 'Key not found' });
    }
    res.json(typeof keys[0].response_body === 'string' ? JSON.parse(keys[0].response_body) : keys[0].response_body);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /orders/:id/cancel
app.post('/orders/:id/cancel', authenticateJWT, async (req, res) => {
  const order_id = req.params.id;
  const conn = await pool.getConnection();

  try {
    await conn.beginTransaction();

    const [orders] = await conn.query('SELECT * FROM orders WHERE id = ? FOR UPDATE', [order_id]);
    if (orders.length === 0) throw new Error('Order not found');

    const order = orders[0];

    if (order.status === 'CANCELED') {
      throw new Error('Order is already canceled');
    }

    if (order.status === 'CONFIRMED') {
      const orderDateRaw = new Date(order.created_at);
      // Adjust for timezone difference if DB stores UTC but parsed as local
      const orderDate = new Date(orderDateRaw.getTime() - (orderDateRaw.getTimezoneOffset() * 60000));
      const now = new Date();
      const diffMinutes = (now - orderDate) / 1000 / 60;

      if (diffMinutes > 10) {
        throw new Error('Cannot cancel a confirmed order after 10 minutes');
      }
    }

    // Cancel and restore stock
    await conn.query('UPDATE orders SET status = ? WHERE id = ?', ['CANCELED', order_id]);
    
    const [items] = await conn.query('SELECT * FROM order_items WHERE order_id = ?', [order_id]);
    for (const item of items) {
      await conn.query('UPDATE products SET stock = stock + ? WHERE id = ?', [item.qty, item.product_id]);
    }

    await conn.commit();
    res.json({ message: 'Order canceled successfully', id: order_id, status: 'CANCELED' });

  } catch (err) {
    await conn.rollback();
    res.status(400).json({ error: err.message });
  } finally {
    conn.release();
  }
});

const PORT = process.env.PORT || 3002;
app.listen(PORT, () => {
  console.log(`✅ Orders API is running on http://localhost:${PORT}`);
});
