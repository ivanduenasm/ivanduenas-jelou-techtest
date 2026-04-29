/**
 * @file customers-api/src/index.js
 * @description Customers API entry point
 * @author Ivan Dueñas
 */

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const { z } = require('zod');
const pool = require('./db');

const app = express();
const JWT_SECRET = process.env.JWT_SECRET || 'operator_super_secret_token';

app.use(cors());
app.use(express.json());

// --- ZOD VALIDATION SCHEMAS ---
const CustomerSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  email: z.string().email('Invalid email format'),
  phone: z.string().optional().nullable()
});

// --- AUTH MIDDLEWARE ---
const authenticateJWT = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (authHeader) {
    const token = authHeader.split(' ')[1];
    jwt.verify(token, JWT_SECRET, (err, user) => {
      if (err) {
        return res.status(403).json({ error: 'Forbidden - Invalid JWT' });
      }
      req.user = user;
      next();
    });
  } else {
    res.status(401).json({ error: 'Unauthorized - Missing JWT' });
  }
};

// --- ROUTES ---

// 0. Login route for Operator
app.post('/login', (req, res) => {
  const { username, password } = req.body;
  if (username === 'operator' && password === 'secret123') {
    const token = jwt.sign({ username: 'operator', role: 'admin' }, JWT_SECRET, { expiresIn: '24h' });
    return res.json({ token });
  }
  res.status(401).json({ error: 'Invalid credentials' });
});

// 0.1 Health Check
app.get('/health', (req, res) => {
  res.json({ status: 'OK', service: 'customers-api' });
});

// 1. POST /customers - Create client
app.post('/customers', authenticateJWT, async (req, res) => {
  try {
    const validation = CustomerSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(400).json({ error: validation.error.errors });
    }

    const { name, email, phone } = validation.data;
    const [result] = await pool.query(
      'INSERT INTO customers (name, email, phone) VALUES (?, ?, ?)',
      [name, email, phone || null]
    );

    res.status(201).json({
      id: result.insertId,
      name,
      email,
      phone
    });
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: 'A customer with this email already exists' });
    }
    console.error(error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// 2. GET /customers/:id - Get details
app.get('/customers/:id', authenticateJWT, async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT id, name, email, phone, created_at FROM customers WHERE id = ?',
      [req.params.id]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Customer not found' });
    }

    res.json(rows[0]);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// 3. GET /customers - Search with cursor pagination
app.get('/customers', authenticateJWT, async (req, res) => {
  try {
    const { search = '', cursor, limit = 10 } = req.query;
    const parsedLimit = Math.min(parseInt(limit) || 10, 100);
    
    let query = 'SELECT id, name, email, phone, created_at FROM customers WHERE 1=1';
    const params = [];

    if (search) {
      query += ' AND (name LIKE ? OR email LIKE ?)';
      params.push(`%${search}%`, `%${search}%`);
    }

    if (cursor) {
      query += ' AND id > ?';
      params.push(parseInt(cursor));
    }

    query += ' ORDER BY id ASC LIMIT ?';
    params.push(parsedLimit + 1); // Grab one extra to check if there is a next page

    const [rows] = await pool.query(query, params);

    let nextCursor = null;
    if (rows.length > parsedLimit) {
      const nextItem = rows.pop(); // Remove the extra item
      nextCursor = nextItem.id;     // Use its ID as the next cursor
    }

    res.json({
      data: rows,
      nextCursor
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// 4. PUT /customers/:id - Update customer
app.put('/customers/:id', authenticateJWT, async (req, res) => {
  try {
    // We use partial() so updating only some fields is valid
    const validation = CustomerSchema.partial().safeParse(req.body);
    if (!validation.success) {
      return res.status(400).json({ error: validation.error.errors });
    }

    const updates = validation.data;
    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: 'No update data provided' });
    }

    const fields = Object.keys(updates).map(key => `${key} = ?`).join(', ');
    const params = [...Object.values(updates), req.params.id];

    const [result] = await pool.query(`UPDATE customers SET ${fields} WHERE id = ?`, params);

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Customer not found' });
    }

    res.json({ message: 'Customer updated successfully' });
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: 'A customer with this email already exists' });
    }
    console.error(error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// 5. DELETE /customers/:id
app.delete('/customers/:id', authenticateJWT, async (req, res) => {
  try {
    const [result] = await pool.query('DELETE FROM customers WHERE id = ?', [req.params.id]);
    
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Customer not found' });
    }

    res.json({ message: 'Customer deleted successfully' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// 6. GET /internal/customers/:id - Internal route with service token
app.get('/internal/customers/:id', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    const token = authHeader && authHeader.split(' ')[1];
    const serviceToken = process.env.SERVICE_TOKEN || 'SUPER_SECRET_SERVICE_TOKEN';

    if (!token || token !== serviceToken) {
      return res.status(401).json({ error: 'Unauthorized - Invalid or missing service token' });
    }

    const [rows] = await pool.query(
      'SELECT id, name, email, phone, created_at FROM customers WHERE id = ?',
      [req.params.id]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Customer not found' });
    }

    res.json(rows[0]);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`✅ Customers API is running on http://localhost:${PORT}`);
});
