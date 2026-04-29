-- @author Ivan Dueñas
-- database initial seed data

-- Insertar clientes de prueba
INSERT INTO customers (name, email, phone) VALUES 
('Empresa Acme', 'ops@acme.com', '+573001234567'),
('Globex Corporation', 'admin@globex.com', '+573109876543'),
('Cyberdyne Systems', 'miles@cyberdyne.com', '+573201112233'),
('Wayne Enterprises', 'bruce@wayne.com', '+573005554433'),
('Stark Industries', 'tony@stark.com', '+573159998877')
ON DUPLICATE KEY UPDATE name=VALUES(name);

-- Insertar productos de prueba
INSERT INTO products (sku, name, price_cents, stock) VALUES 
('PROD-001', 'Laptop Pro 15', 129900, 50),
('PROD-002', 'Monitor 4K', 459900, 30),
('PROD-003', 'Teclado Mecánico', 85000, 100),
('PROD-004', 'Mouse Inalámbrico', 45000, 150),
('PROD-005', 'Silla Ergonómica Gamer', 250000, 20),
('PROD-006', 'Auriculares Bluetooth', 75000, 0), -- Out of stock!
('PROD-007', 'Escritorio Elevable', 599900, 5)
ON DUPLICATE KEY UPDATE stock=VALUES(stock), price_cents=VALUES(price_cents), name=VALUES(name);
