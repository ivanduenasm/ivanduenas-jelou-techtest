# JelouAI B2B Microservices - Sistema de Pedidos
**Desarrollado por:** Ivan Dueñas

Ecosistema de microservicios acoplados para la administración transaccional de clientes, órdenes e inventario, integrado mediante un orquestador AWS Lambda.

## 🏗️ Arquitectura del Ecosistema

1. **Customers API (Puerto `3001`)**: Repositorio maestro de identidades B2B.
2. **Orders API (Puerto `3002`)**: Motor transaccional para gestión de stock y confirmación idempotente.
3. **Lambda Orchestrator (Puerto `3003` Local)**: Orquestador serverless que consolida operaciones en bloque.

---

## ⚙️ Variables de Entorno (.env)

Debe existir un archivo `.env` en la raíz de cada API respectiva con los siguientes parámetros:

### Customers API
```env
PORT=3001
DB_HOST=127.0.0.1 (Override a 'db' en docker)
DB_PORT=3306
DB_USER=root
DB_PASSWORD=root
DB_NAME=b2b_orders
SERVICE_TOKEN=SUPER_SECRET_SERVICE_TOKEN
JWT_SECRET=operator_super_secret_token
```

### Orders API
```env
PORT=3002
DB_HOST=127.0.0.1
DB_PORT=3306
DB_USER=root
DB_PASSWORD=root
DB_NAME=b2b_orders
SERVICE_TOKEN=SUPER_SECRET_SERVICE_TOKEN
JWT_SECRET=operator_super_secret_token
CUSTOMERS_API_URL=http://127.0.0.1:3001
```

### Lambda Orchestrator
```env
CUSTOMERS_API_BASE=http://localhost:3001/internal/customers
ORDERS_API_BASE=http://localhost:3002
SERVICE_TOKEN=SUPER_SECRET_SERVICE_TOKEN
```

---

## 🚀 Instrucciones de Despliegue Local

### 1. Ejecutar mediante Docker Compose (Recomendado)
El contenedor inicializará MySQL, cargará los esquemas y habilitará los microservicios automáticamente:
```bash
docker-compose build
docker-compose up -d
```

### 2. Ejecutar de Manera Independiente
Si desea correr los servicios usando Node nativo:
```bash
# Levantar Base de Datos primero
docker-compose up -d db

# Levantar Customers API
cd customers-api && npm install && npm run dev

# Levantar Orders API
cd orders-api && npm install && npm run dev

# Levantar Lambda Orchestrator
cd lambda-orchestrator && npm install && npm start
```

---

## 📡 Ejemplos de Consumo (cURL)

### 1. Autenticar Operador (Obtener JWT)
```bash
curl -X POST http://localhost:3001/login \
  -H "Content-Type: application/json" \
  -d '{"username":"operator","password":"secret123"}'
```

### 2. Crear Cliente (Requiere JWT)
```bash
curl -X POST http://localhost:3001/customers \
  -H "Authorization: Bearer <OPERATOR_JWT>" \
  -H "Content-Type: application/json" \
  -d '{"name":"Comercializadora Bogotá","email":"ventas@bogota.co","phone":"+573001234567"}'
```

### 3. Crear Producto en Inventario (Requiere JWT)
```bash
curl -X POST http://localhost:3002/products \
  -H "Authorization: Bearer <OPERATOR_JWT>" \
  -H "Content-Type: application/json" \
  -d '{"sku":"SKU-CAFE-01","name":"Café Especial 500g","price_cents":25000,"stock":100}'
```

### 4. Ejecución del Orquestador (Flujo Completo)
Invoca el endpoint HTTP expuesto por el orquestador Serverless:
```bash
curl -X POST http://localhost:3003/dev/orchestrator/create-and-confirm-order \
  -H "Content-Type: application/json" \
  -d '{
    "customer_id": 1,
    "items": [
      { "product_id": 1, "qty": 2 }
    ],
    "idempotency_key": "test-unique-key-001",
    "correlation_id": "req-bogota-001"
  }'
```

---

## ☁️ Despliegue en Producción (AWS)

Para aprovisionar la infraestructura serverless directamente en Amazon Web Services:
```bash
cd lambda-orchestrator
serverless deploy --stage prod
```

### 🎯 Endpoint Público de Prueba Activo
Para facilitar la revisión sin dependencias locales, se encuentra disponible un despliegue funcional en vivo:
* **URL:** `https://mi2mr4ks93.execute-api.us-east-1.amazonaws.com/dev/orchestrator/create-and-confirm-order`
* **Método:** `POST`
* **Payload de prueba:**
```json
{
  "customer_id": 3,
  "items": [
    { "product_id": 4, "qty": 1 }
  ],
  "idempotency_key": "eval-test-key-101",
  "correlation_id": "eval-run"
}
```

