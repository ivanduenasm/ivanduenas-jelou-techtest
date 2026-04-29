# 🧪 Bitácora de Pruebas y Verificación del Sistema

Este documento consolida los escenarios de prueba ejecutados para certificar el comportamiento del orquestador Serverless y las APIs transaccionales.

## ☁️ Endpoint de Pruebas en Producción (AWS)
* **Host Base:** `https://mi2mr4ks93.execute-api.us-east-1.amazonaws.com/dev`
* **Ruta Orquestada:** `/orchestrator/create-and-confirm-order`

---

## 🛠️ Casos de Uso Certificados

### 🟢 Caso 1: Flujo Principal (Happy Path)
Garantiza que la validación del cliente, el descuento de inventario y la creación del registro se resuelven en bloque.
* **JSON Request:**
```json
{ 
  "customer_id": 1, 
  "items": [ 
    { "product_id": 2, "qty": 3 } 
  ], 
  "idempotency_key": "abc-123", 
  "correlation_id": "req-789" 
}
```
* **Resultado esperado:** `201 Created` - Retorno de información del cliente + desglose totalizado de la orden.

### 🔵 Caso 2: Validación de Idempotencia
Ejecuta el re-envío del payload anterior. Evita duplicación transaccional mediante lectura de caché.
* **JSON Request:** *Mismo payload anterior (abc-123)*
* **Resultado esperado:** `200 OK` - Respuesta idéntica extraída directamente desde el historial de idempotencia.

### 🔴 Caso 3: Validación de Stock Insuficiente
Control de seguridad sobre inventarios en cero.
* **JSON Request:**
```json
{
  "customer_id": 1,
  "items": [ { "product_id": 6, "qty": 1 } ],
  "idempotency_key": "abc-stock-fail",
  "correlation_id": "req-stock-check"
}
```
* **Resultado esperado:** `400 Bad Request`
* **Mensaje de Error:** `"Insufficient stock for Product 6 (Requested: 1, Available: 0)"`

### 🔴 Caso 4: Validación de Cliente Inexistente
Filtro preventivo sobre integraciones huérfanas.
* **JSON Request:**
```json
{
  "customer_id": 9999,
  "items": [ { "product_id": 4, "qty": 1 } ],
  "idempotency_key": "abc-customer-fail",
  "correlation_id": "req-customer-check"
}
```
* **Resultado esperado:** `404 Not Found`
* **Mensaje de Error:** `"Customer not found"`
