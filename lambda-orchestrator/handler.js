/**
 * @file lambda-orchestrator/handler.js
 * @description AWS Lambda gateway handler logic
 * @author Ivan Dueñas
 */

const axios = require('axios');

module.exports.orchestrate = async (event) => {
  try {
    // Serverless offline parses bodies, but we evaluate raw inputs to ensure safety
    const body = typeof event.body === 'string' ? JSON.parse(event.body || '{}') : event.body;
    const { customer_id, items, idempotency_key, correlation_id } = body || {};

    console.log('Orchestrator Body:', body);

    if (!customer_id || !items || !idempotency_key) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'customer_id, items, and idempotency_key are mandatory' })
      };
    }

    const CUSTOMERS_URL = process.env.CUSTOMERS_API_BASE || process.env.CUSTOMERS_API_URL || 'http://localhost:3001';
    const ORDERS_URL = process.env.ORDERS_API_BASE || process.env.ORDERS_API_URL || 'http://localhost:3002';
    const SERVICE_TOKEN = process.env.SERVICE_TOKEN || 'SUPER_SECRET_SERVICE_TOKEN';

    // 0. Check Idempotency
    try {
      const checkRes = await axios.get(`${ORDERS_URL}/orders/idempotency/${idempotency_key}`);
      if (checkRes.data) {
        // Key already exists, bypass workflow completely
        return {
          statusCode: 200,
          headers: {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Credentials': true,
          },
          body: JSON.stringify({
            success: true,
            correlationId: correlation_id || null,
            data: checkRes.data
          })
        };
      }
    } catch (err) {
      // 404 is expected for new operations, ignore other errors for now
      if (err.response && err.response.status !== 404) {
        console.error('Idempotency Check Issue:', err.message);
      }
    }

    // 1. Validate Customer
    let customer;
    try {
      const url = `${CUSTOMERS_URL}/internal/customers/${customer_id}`;
      console.log('Hitting Customer API:', url);
      const customerRes = await axios.get(url, {
        headers: { Authorization: `Bearer ${SERVICE_TOKEN}` }
      });
      customer = customerRes.data;
    } catch (error) {
      if (error.response && error.response.status === 404) {
        return {
          statusCode: 404,
          body: JSON.stringify({ error: 'Customer not found' })
        };
      }
      return {
        statusCode: error.response?.status || 500,
        body: JSON.stringify({ error: 'Failed to reach Customers service' })
      };
    }

    // 2. Create Order
    let order;
    try {
      const orderRes = await axios.post(
        `${ORDERS_URL}/orders`,
        { customer_id, items },
        { headers: { Authorization: `Bearer ${SERVICE_TOKEN}` } }
      );
      order = orderRes.data;
    } catch (error) {
      console.error('Create Order error details:', error.response?.data || error.message);
      return {
        statusCode: error.response?.status || 400,
        body: JSON.stringify({ error: error.response?.data?.error || 'Failed to create order' })
      };
    }

    // 3. Confirm Order
    let confirmedOrder;
    try {
      const confirmRes = await axios.post(
        `${ORDERS_URL}/orders/${order.id}/confirm`,
        {},
        { 
          headers: { 
            'X-Idempotency-Key': idempotency_key,
            Authorization: `Bearer ${SERVICE_TOKEN}`
          } 
        }
      );
      confirmedOrder = confirmRes.data;
    } catch (error) {
      return {
        statusCode: error.response?.status || 400,
        body: JSON.stringify({ error: error.response?.data?.error || 'Failed to confirm order' })
      };
    }

    // 4. Consolidated response formatting
    const response = {
      success: true,
      correlationId: correlation_id || null,
      data: {
        customer: {
          id: customer.id,
          name: customer.name,
          email: customer.email,
          phone: customer.phone
        },
        order: {
          id: confirmedOrder.id,
          status: confirmedOrder.status,
          total_cents: confirmedOrder.total_cents,
          items: confirmedOrder.items.map(i => ({
            product_id: i.product_id,
            qty: i.qty,
            unit_price_cents: i.unit_price_cents,
            subtotal_cents: i.subtotal_cents
          }))
        }
      }
    };

    return {
      statusCode: 201,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Credentials': true,
      },
      body: JSON.stringify(response)
    };

  } catch (err) {
    console.error(err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Internal system fault' })
    };
  }
};
